// NEW — Zod-validated env loader. Import side-effect-free; call loadEnv() once on boot.

import dotenv from "dotenv";
if (process.env.NODE_ENV !== "test") {
  dotenv.config();
}
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TEST_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional().default(""),
  SESSION_JWT_SECRET: z.string().min(16, "SESSION_JWT_SECRET must be at least 16 chars"),
  OTP_PEPPER: z.string().min(8, "OTP_PEPPER must be at least 8 chars"),
  PORT: z
    .string()
    .optional()
    .default("4000")
    .transform((v) => Number.parseInt(v, 10))
    .pipe(z.number().int().positive()),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .optional()
    .default("development"),
  /** Explicit allow-all toggle. Unset = open in dev, allowlist in production when CORS_ORIGINS is set. */
  CORS_ALLOW_ALL: z.enum(["true", "false", "1", "0"]).optional(),
  CORS_ORIGINS: z.string().optional().default(""),
  // SMS — leave WASILIANA_API_KEY unset to fall back to console logging (dev).
  WASILIANA_API_KEY: z.string().optional(),
  WASILIANA_SENDER_ID: z.string().optional(),
  WASILIANA_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function corsOrigins(env: Env): string[] {
  const raw = env.CORS_ORIGINS.trim();
  if (raw === "*" || raw === "all") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "*");
}

/** True → cors package reflects any Origin (works with credentials). */
export function shouldAllowAllCorsOrigins(env: Env): boolean {
  const flag = env.CORS_ALLOW_ALL;
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  // Unset: any origin in dev/test; production uses allowlist when CORS_ORIGINS is set.
  if (env.NODE_ENV !== "production") return true;
  return corsOrigins(env).length === 0;
}

/** Expo web tunnel / local dev hosts (not used when allow-all is on). */
export function isExpoDevWebOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".exp.direct") ||
      hostname.endsWith(".exp.host")
    );
  } catch {
    return false;
  }
}

export function corsOriginSetting(env: Env): boolean | string[] | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void) {
  if (shouldAllowAllCorsOrigins(env)) return true;
  const origins = corsOrigins(env);
  if (origins.length === 0) return true;

  const allowlist = new Set(origins);
  const allowExpoDev = env.NODE_ENV !== "production";

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowlist.has(origin) || (allowExpoDev && isExpoDevWebOrigin(origin))) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS blocked origin: ${origin}`));
  };
}

// For tests — reset cached env so a fresh process.env can be reloaded.
export function _resetEnvCache(): void {
  cached = null;
}
