import type { Role } from "./auth-role.js";
import type { RedisLike } from "./redis.js";

const TTL_MS = 15 * 60 * 1000;

export type PendingRegistration = {
  phone: string;
  role: Role;
  passwordHash: string;
  name: string | null;
  email: string | null;
};

function key(role: Role, phone: string): string {
  return `reg:pending:${role}:${phone}`;
}

export async function storePendingRegistration(
  redis: RedisLike,
  data: PendingRegistration,
): Promise<void> {
  await redis.set(key(data.role, data.phone), JSON.stringify(data), { pxMs: TTL_MS });
}

export async function consumePendingRegistration(
  redis: RedisLike,
  role: Role,
  phone: string,
): Promise<PendingRegistration | null> {
  const raw = await redis.get(key(role, phone));
  if (!raw) return null;
  await redis.del(key(role, phone));
  try {
    return JSON.parse(raw) as PendingRegistration;
  } catch {
    return null;
  }
}
