import type { Request } from "express";
import { createHash } from "node:crypto";
import { AppError } from "./errors.js";
import { getRedis } from "./redis.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const WAIT_MS = 5000;
const POLL_MS = 50;

export interface IdempotencyCachedResponse<T> {
  status: number;
  body: T;
}

interface IdempotencyRecord<T> {
  state: "pending" | "done";
  fingerprint: string;
  response?: IdempotencyCachedResponse<T>;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(req: Request): string {
  return createHash("sha256")
    .update(req.method)
    .update(":")
    .update(req.originalUrl)
    .update(":")
    .update(stableStringify(req.body ?? null))
    .digest("hex");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withIdempotency<T>(
  req: Request,
  namespace: string,
  handler: () => Promise<IdempotencyCachedResponse<T>>,
): Promise<IdempotencyCachedResponse<T>> {
  const key = req.header("Idempotency-Key");
  if (!key || !req.user) return handler();

  const redis = getRedis();
  const cacheKey = `idemp:${namespace}:${req.user.id}:${key}`;
  const fp = fingerprint(req);
  const pending: IdempotencyRecord<T> = { state: "pending", fingerprint: fp };
  const reserved = await redis.set(cacheKey, JSON.stringify(pending), { pxMs: TTL_MS, nx: true });
  if (!reserved) {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const cached = await redis.get(cacheKey);
      if (!cached) break;
      const record = JSON.parse(cached) as IdempotencyRecord<T>;
      if (record.fingerprint !== fp) {
        throw new AppError("IDEMPOTENCY_KEY_REUSED", 409, "Idempotency key reused for a different request.");
      }
      if (record.state === "done" && record.response) return record.response;
      await sleep(POLL_MS);
    }
    throw new AppError("IDEMPOTENCY_IN_PROGRESS", 409, "Idempotent request is still in progress.");
  }

  try {
    const result = await handler();
    const done: IdempotencyRecord<T> = { state: "done", fingerprint: fp, response: result };
    await redis.set(cacheKey, JSON.stringify(done), { pxMs: TTL_MS });
    return result;
  } catch (err) {
    await redis.del(cacheKey);
    throw err;
  }
}
