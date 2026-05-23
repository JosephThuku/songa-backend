import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "./errors.js";

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export function validatePasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new AppError("WEAK_PASSWORD", 400, "Password must be at least 8 characters.");
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordStrength(password);
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(expected, derived);
}
