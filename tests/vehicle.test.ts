// Integration tests for driver vehicle registration and online-status gating.

import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp, createAuthSession } from "./helpers.js";

// Unique phones — no overlap with other test files.
const DRIVER_PHONE = "+254711000001";
const PASSENGER_PHONE = "+254711000002";

async function loginDriver(app: Express): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, DRIVER_PHONE, "driver", { name: "Vehicle Driver" });
  return { token: session.sessionToken, userId: session.user.id };
}

const VEHICLE_BODY = {
  type: "Car",
  make: "Toyota",
  model: "Axio",
  registration: "KVH001A",
  color: "Silver",
  seats: 4,
};

describe("Vehicle registration and VEHICLE_REQUIRED gate", () => {
  it("successfully registers a vehicle and returns the vehicle DTO", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);

    const res = await request(app)
      .post("/api/drivers/me/vehicle")
      .set("Authorization", `Bearer ${driver.token}`)
      .send(VEHICLE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.vehicle).toMatchObject({
      id: expect.any(String),
      type: "Car",
      make: "Toyota",
      model: "Axio",
      registration: "KVH001A",
      color: "Silver",
      seats: 4,
      status: "Activated",
    });
    expect(res.body.vehicle.year).toBeNull();
  });

  it("stores registration in uppercase regardless of input casing", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);

    const res = await request(app)
      .post("/api/drivers/me/vehicle")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ ...VEHICLE_BODY, registration: "kvh002a" });

    expect(res.status).toBe(200);
    expect(res.body.vehicle.registration).toBe("KVH002A");
  });

  it("accepts optional year field", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);

    const res = await request(app)
      .post("/api/drivers/me/vehicle")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ ...VEHICLE_BODY, registration: "KVH003A", year: "2022" });

    expect(res.status).toBe(200);
    expect(res.body.vehicle.year).toBe("2022");
  });

  it("returns VEHICLE_REQUIRED when going online without a registered vehicle", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);

    // No vehicle registered — going online must fail.
    const res = await request(app)
      .patch("/api/drivers/me/online")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ isOnline: true });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("VEHICLE_REQUIRED");
  });

  it("allows going online after a vehicle is registered", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);

    await request(app)
      .post("/api/drivers/me/vehicle")
      .set("Authorization", `Bearer ${driver.token}`)
      .send(VEHICLE_BODY)
      .expect(200);

    const online = await request(app)
      .patch("/api/drivers/me/online")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ isOnline: true });

    expect(online.status).toBe(200);
    expect(online.body.isOnline).toBe(true);
    expect(online.body.onlineSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("passengers cannot register a vehicle", async () => {
    const app = buildTestApp();
    const session = await createAuthSession(app, PASSENGER_PHONE, "passenger", {
      name: "Passenger",
    });

    const res = await request(app)
      .post("/api/drivers/me/vehicle")
      .set("Authorization", `Bearer ${session.sessionToken}`)
      .send(VEHICLE_BODY);

    expect(res.status).toBe(403);
  });

  it("upserts vehicle on repeated registration with same plate (updates fields)", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);

    // First registration.
    await request(app)
      .post("/api/drivers/me/vehicle")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ ...VEHICLE_BODY, registration: "KVH004A", color: "White" })
      .expect(200);

    // Same plate, different color.
    const updated = await request(app)
      .post("/api/drivers/me/vehicle")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ ...VEHICLE_BODY, registration: "KVH004A", color: "Black" });

    expect(updated.status).toBe(200);
    expect(updated.body.vehicle.color).toBe("Black");
    expect(updated.body.vehicle.registration).toBe("KVH004A");
  });

  it("rejects invalid vehicle type", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);

    const res = await request(app)
      .post("/api/drivers/me/vehicle")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ ...VEHICLE_BODY, type: "Helicopter" });

    expect(res.status).toBe(400);
  });
});
