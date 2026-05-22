// NEW — Zod-validated env loader. Import side-effect-free; call loadEnv() once on boot.

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
  CORS_ORIGINS: z.string().optional().default(""),
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
  return env.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// For tests — reset cached env so a fresh process.env can be reloaded.
export function _resetEnvCache(): void {
  cached = null;
}
