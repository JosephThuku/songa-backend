// Test helpers: build app, register, login.

import type { Express } from "express";
import request from "supertest";
import { buildApp } from "../src/app.js";
import { _resetEnvCache, loadEnv } from "../src/config/env.js";

export const TEST_PASSWORD = "TestPass123";

export function buildTestApp(): Express {
  _resetEnvCache();
  const env = loadEnv();
  return buildApp({ env });
}

export type AuthSession = {
  sessionToken: string;
  user: { id: string; phone: string; role: string; name?: string | null; email?: string | null };
};

/**
 * Register → confirm OTP → login. Returns a session token for API calls.
 */
export async function createAuthSession(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
  opts?: { password?: string; name?: string; email?: string },
): Promise<AuthSession> {
  const password = opts?.password ?? TEST_PASSWORD;

  const reg = await request(app)
    .post("/api/auth/register")
    .set("x-dev-show-otp", "1")
    .send({
      phone,
      role,
      password,
      ...(opts?.name ? { name: opts.name } : {}),
      ...(opts?.email ? { email: opts.email } : {}),
    });
  if (reg.status !== 200) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  }
  const devCode = reg.body.devCode as string | undefined;
  if (!devCode) {
    throw new Error("register: devCode missing (set x-dev-show-otp: 1)");
  }

  const confirm = await request(app)
    .post("/api/auth/register/confirm")
    .send({ phone, role, code: devCode });
  if (confirm.status !== 200) {
    throw new Error(`register/confirm failed: ${confirm.status} ${JSON.stringify(confirm.body)}`);
  }

  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: phone, password, role });
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  return {
    sessionToken: login.body.sessionToken as string,
    user: login.body.user as AuthSession["user"],
  };
}
