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

/** Register a vehicle and go online with a fresh GPS fix (required for dispatch/search tests). */
export async function setupDriverForDispatch(
  app: Express,
  token: string,
  opts?: {
    type?: "Car" | "Van" | "Minibus" | "Bike" | "Tuktuk";
    lat?: number;
    lng?: number;
    registration?: string;
    seats?: number;
  },
): Promise<void> {
  const type = opts?.type ?? "Car";
  const registration = opts?.registration ?? `KTE${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const vehicle = await request(app)
    .post("/api/drivers/me/vehicle")
    .set("Authorization", `Bearer ${token}`)
    .send({
      type,
      make: "Toyota",
      model: "Test",
      registration,
      color: "White",
      seats: opts?.seats ?? 4,
    });
  if (vehicle.status !== 200) {
    throw new Error(`vehicle register failed: ${vehicle.status} ${JSON.stringify(vehicle.body)}`);
  }

  const online = await request(app)
    .patch("/api/drivers/me/online")
    .set("Authorization", `Bearer ${token}`)
    .send({ isOnline: true });
  if (online.status !== 200) {
    throw new Error(`driver online failed: ${online.status} ${JSON.stringify(online.body)}`);
  }

  const location = await request(app)
    .post("/api/drivers/me/location")
    .set("Authorization", `Bearer ${token}`)
    .send({ lat: opts?.lat ?? -1.319, lng: opts?.lng ?? 36.928 });
  if (location.status !== 204) {
    throw new Error(`driver location failed: ${location.status} ${JSON.stringify(location.body)}`);
  }
}
