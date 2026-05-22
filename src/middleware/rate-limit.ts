// NEW — Redis sliding-window rate limiter.

import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { AppError } from "../lib/errors.js";
import { getRedis, type RedisLike } from "../lib/redis.js";

export interface RateLimitOptions {
  /** Limit key prefix, e.g. "otp:send:phone". */
  prefix: string;
  /** Max requests allowed within `windowMs`. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Pull the bucket identifier from the request (e.g. phone, ip). */
  identifier: (req: Request) => string | null;
  /** Optional override message. */
  message?: string;
}

/**
 * Sliding-window counter using a sorted set keyed by `${prefix}:${id}`.
 * Each call:
 *   1. removes scores < (now - windowMs)
 *   2. counts remaining
 *   3. if count >= max → 429 RATE_LIMITED
 *   4. otherwise adds a new entry with score=now
 *   5. resets the key TTL to windowMs
 */
export async function consumeSlidingWindow(
  redis: RedisLike,
  key: string,
  max: number,
  windowMs: number,
): Promise<{ allowed: boolean; count: number }> {
  const now = Date.now();
  const cutoff = now - windowMs;
  await redis.zremrangebyscore(key, 0, cutoff);
  const count = await redis.zcard(key);
  if (count >= max) {
    return { allowed: false, count };
  }
  await redis.zadd(key, now, `${now}-${randomUUID()}`);
  await redis.pexpire(key, windowMs);
  return { allowed: true, count: count + 1 };
}

export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = opts.identifier(req);
      if (!id) {
        next();
        return;
      }
      const key = `ratelimit:${opts.prefix}:${id}`;
      const { allowed } = await consumeSlidingWindow(
        getRedis(),
        key,
        opts.max,
        opts.windowMs,
      );
      if (!allowed) {
        throw new AppError(
          "RATE_LIMITED",
          429,
          opts.message ?? "Too many requests. Please try again later.",
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requestIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}
