import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const PASSENGER_PHONE = "+254716000001";
const DRIVER_PHONE = "+254726000001";

async function login(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, phone, role);
  return { token: session.sessionToken, userId: session.user.id };
}

describe("POST /api/rides/search", () => {
  it("returns car as available when a driver is online near pickup", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    await setupDriverForDispatch(app, driver.token, { lat: -1.319, lng: 36.928 });

    const res = await request(app)
      .post("/api/rides/search")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: { label: "JKIA Terminal 1A", lat: -1.3192, lng: 36.9278 },
        dropoff: { label: "Westlands", lat: -1.2674, lng: 36.807 },
      });

    expect(res.status).toBe(200);
    const car = res.body.options.find((option: { optionId: string }) => option.optionId === "car");
    expect(car).toMatchObject({
      optionId: "car",
      vehicleType: "Car",
      available: true,
      pickupEtaMinutes: expect.any(Number),
      priceAmount: expect.any(Number),
      currency: "KES",
    });
  });

  it("rejects identical pickup and dropoff", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const place = { label: "Westlands", lat: -1.2674, lng: 36.807 };

    const res = await request(app)
      .post("/api/rides/search")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ pickup: place, dropoff: place });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("uses seat_selection booking mode for airport trips", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");

    const res = await request(app)
      .post("/api/rides/search")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: { label: "JKIA Terminal 1A", lat: -1.3192, lng: 36.9278 },
        dropoff: { label: "Westlands", lat: -1.2674, lng: 36.807 },
      });

    expect(res.status).toBe(200);
    expect(res.body.bookingMode).toBe("seat_selection");
    expect(res.body.requiresSeats).toBe(true);
  });
});
