// NEW — OTP generate / hash / verify.

import { createHash, randomInt } from "node:crypto";
import type { RedisLike } from "./redis.js";

export const OTP_TTL_SECONDS = 300;

function pepper(): string {
  const p = process.env.OTP_PEPPER;
  if (!p || p.length === 0) {
    throw new Error("OTP_PEPPER is not configured");
  }
  return p;
}

export function generateOtpCode(): string {
  // 6 digits, leading-zero-padded
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export function hashOtp(code: string): string {
  return createHash("sha256").update(code + pepper()).digest("hex");
}

export type OtpPurpose = "register" | "legacy";

export function otpKey(purpose: OtpPurpose, role: string, phone: string): string {
  return `otp:${purpose}:${role}:${phone}`;
}

export async function storeOtp(
  redis: RedisLike,
  purpose: OtpPurpose,
  role: string,
  phone: string,
  code: string,
): Promise<void> {
  await redis.set(otpKey(purpose, role, phone), hashOtp(code), { pxMs: OTP_TTL_SECONDS * 1000 });
}

export async function consumeOtp(
  redis: RedisLike,
  purpose: OtpPurpose,
  role: string,
  phone: string,
  code: string,
): Promise<boolean> {
  const key = otpKey(purpose, role, phone);
  const stored = await redis.get(key);
  if (!stored) return false;
  const candidate = hashOtp(code);
  if (stored !== candidate) return false;
  await redis.del(key); // one-shot
  return true;
}
