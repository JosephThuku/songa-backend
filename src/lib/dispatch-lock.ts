import { getRedis } from "./redis.js";

const LOCK_MS = 5000;

export async function withDispatchLock(rideId: string, fn: () => Promise<void>): Promise<void> {
  const redis = getRedis();
  const key = `songa:dispatch:lock:${rideId}`;
  const acquired = await redis.set(key, "1", { nx: true, pxMs: LOCK_MS });
  if (acquired !== "OK") return;
  try {
    await fn();
  } finally {
    await redis.del(key);
  }
}
