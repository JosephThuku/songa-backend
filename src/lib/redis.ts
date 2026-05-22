// NEW — Redis client with an in-memory fallback. Auto-selects based on REDIS_URL.

import { Redis as IORedis } from "ioredis";
import { logger } from "./logger.js";

type IORedisClient = InstanceType<typeof IORedis>;

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    opts?: { pxMs?: number; nx?: boolean },
  ): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  // ZSET ops for sliding-window rate limiting
  zadd(key: string, score: number, member: string): Promise<number>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  quit(): Promise<void>;
}

// ---------- In-memory implementation ----------

interface MemEntry {
  value: string;
  expiresAt: number | null;
}
interface MemZSet {
  members: Map<string, number>;
  expiresAt: number | null;
}

export class MemoryClient implements RedisLike {
  private store = new Map<string, MemEntry>();
  private zsets = new Map<string, MemZSet>();

  private isExpired(entry: { expiresAt: number | null }): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  private gcKey(key: string): void {
    const entry = this.store.get(key);
    if (entry && this.isExpired(entry)) this.store.delete(key);
    const zset = this.zsets.get(key);
    if (zset && this.isExpired(zset)) this.zsets.delete(key);
  }

  async get(key: string): Promise<string | null> {
    this.gcKey(key);
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  async set(
    key: string,
    value: string,
    opts?: { pxMs?: number; nx?: boolean },
  ): Promise<"OK" | null> {
    this.gcKey(key);
    if (opts?.nx && this.store.has(key)) return null;
    const expiresAt = opts?.pxMs ? Date.now() + opts.pxMs : null;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (this.store.delete(k)) count++;
      if (this.zsets.delete(k)) count++;
    }
    return count;
  }

  async incr(key: string): Promise<number> {
    this.gcKey(key);
    const cur = this.store.get(key);
    const next = (cur ? Number.parseInt(cur.value, 10) || 0 : 0) + 1;
    this.store.set(key, {
      value: String(next),
      expiresAt: cur?.expiresAt ?? null,
    });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    const zset = this.zsets.get(key);
    if (zset) {
      zset.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ms;
      return 1;
    }
    const zset = this.zsets.get(key);
    if (zset) {
      zset.expiresAt = Date.now() + ms;
      return 1;
    }
    return 0;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.gcKey(key);
    let zset = this.zsets.get(key);
    if (!zset) {
      zset = { members: new Map(), expiresAt: null };
      this.zsets.set(key, zset);
    }
    const isNew = !zset.members.has(member);
    zset.members.set(member, score);
    return isNew ? 1 : 0;
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    this.gcKey(key);
    const zset = this.zsets.get(key);
    if (!zset) return 0;
    let removed = 0;
    for (const [member, score] of zset.members.entries()) {
      if (score >= min && score <= max) {
        zset.members.delete(member);
        removed++;
      }
    }
    return removed;
  }

  async zcard(key: string): Promise<number> {
    this.gcKey(key);
    const zset = this.zsets.get(key);
    return zset ? zset.members.size : 0;
  }

  async quit(): Promise<void> {
    this.store.clear();
    this.zsets.clear();
  }
}

// ---------- ioredis adapter ----------

export class IoredisClient implements RedisLike {
  constructor(private client: IORedisClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(
    key: string,
    value: string,
    opts?: { pxMs?: number; nx?: boolean },
  ): Promise<"OK" | null> {
    if (opts?.pxMs && opts?.nx) {
      const res = await this.client.set(key, value, "PX", opts.pxMs, "NX");
      return res === "OK" ? "OK" : null;
    }
    if (opts?.pxMs) {
      const res = await this.client.set(key, value, "PX", opts.pxMs);
      return res === "OK" ? "OK" : null;
    }
    if (opts?.nx) {
      const res = await this.client.set(key, value, "NX");
      return res === "OK" ? "OK" : null;
    }
    const res = await this.client.set(key, value);
    return res === "OK" ? "OK" : null;
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async pexpire(key: string, ms: number): Promise<number> {
    return this.client.pexpire(key, ms);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const res = await this.client.zadd(key, score, member);
    return typeof res === "number" ? res : Number.parseInt(String(res), 10) || 0;
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.client.zremrangebyscore(key, min, max);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }
}

// ---------- Factory ----------

let cached: RedisLike | null = null;

export function getRedis(): RedisLike {
  if (cached) return cached;
  const url = process.env.REDIS_URL;
  if (url && url.length > 0) {
    const client = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    client.on("error", (err: unknown) => logger.error({ err }, "redis error"));
    cached = new IoredisClient(client);
  } else {
    logger.debug("REDIS_URL not set — using in-memory Redis fallback");
    cached = new MemoryClient();
  }
  return cached;
}

// For tests — replace or reset the singleton.
export function _setRedis(client: RedisLike | null): void {
  cached = client;
}

/**
 * Test-only helper: clears all data in the in-memory Redis fallback so each
 * test starts with a clean slate. No-ops if the cached client is not the
 * in-memory implementation (e.g. when REDIS_URL is set in production).
 */
export async function resetRedisForTest(): Promise<void> {
  if (cached && cached instanceof MemoryClient) {
    await cached.quit();
  }
  // If no client cached yet, nothing to clear. If using ioredis, we deliberately
  // don't FLUSHDB on a real instance.
}
