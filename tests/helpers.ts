// Test helpers: build a fresh Express app and grab dev OTP codes.

import type { Express } from "express";
import request from "supertest";
import { buildApp } from "../src/app.js";
import { _resetEnvCache, loadEnv } from "../src/config/env.js";

export function buildTestApp(): Express {
  _resetEnvCache();
  const env = loadEnv();
  return buildApp({ env });
}

export interface SendOtpResponse {
  ok: true;
  expiresInSeconds: number;
  devCode?: string;
}

/**
 * POSTs /api/auth/otp/send with the dev OTP reveal header and returns the body.
 * Asserts that a devCode came back so callers can pass it to verify.
 */
export async function sendOtpAndGetCode(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
): Promise<{ devCode: string; body: SendOtpResponse }> {
  const res = await request(app)
    .post("/api/auth/otp/send")
    .set("x-dev-show-otp", "1")
    .send({ phone, role });
  if (res.status !== 200) {
    throw new Error(
      `sendOtpAndGetCode: expected 200, got ${res.status} — ${JSON.stringify(res.body)}`,
    );
  }
  const body = res.body as SendOtpResponse;
  if (!body.devCode) {
    throw new Error(
      `sendOtpAndGetCode: dev code missing from response: ${JSON.stringify(body)}`,
    );
  }
  return { devCode: body.devCode, body };
}
