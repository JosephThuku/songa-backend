import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/lib/openapi.js";
import { prisma } from "../src/lib/prisma.js";
import { seedSharedRidesCoast } from "../prisma/seeds/shared-rides-coast.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const PASSENGER_PHONE = "+254713300101";
const DRIVER_PHONE = "+254713300102";
const DEMO_DEPARTURE_ID = "dep_seed_nyali_sgr_morning";

describe("shared rides pickup pin and driver location", () => {
  it("registers OpenAPI paths for pickup and location", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/api/shared-rides/departures/{departureId}/location"]?.patch).toBeDefined();
  });

  it("stores pickup pin on reserve and exposes driver location after boarding", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const passenger = await createAuthSession(app, PASSENGER_PHONE, "passenger");
    const driver = await createAuthSession(app, DRIVER_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 14 });

    await prisma.sharedDeparture.update({
      where: { id: DEMO_DEPARTURE_ID },
      data: { driverId: driver.user.id, status: "scheduled" },
    });

    const reserve = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/seats/reserve`)
      .set("Authorization", `Bearer ${passenger.sessionToken}`)
      .send({
        seatNumbers: [5],
        pickup: { label: "City Mall gate", lat: -4.043, lng: 39.71 },
      });
    expect(reserve.status).toBe(200);

    const seat = await prisma.sharedDepartureSeat.findFirst({
      where: { departureId: DEMO_DEPARTURE_ID, seatNumber: 5 },
    });
    expect(seat?.pickupLabel).toBe("City Mall gate");
    expect(seat?.pickupLat).toBe(-4.043);

    const loc = await request(app)
      .patch(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/location`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({ lat: -4.04, lng: 39.72 });
    expect(loc.status).toBe(200);
    expect(loc.body.departure.driverLocation?.lat).toBe(-4.04);

    await request(app)
      .patch(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/status`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({ status: "boarding" });

    const track = await request(app)
      .get(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}`)
      .set("Authorization", `Bearer ${passenger.sessionToken}`);
    expect(track.status).toBe(200);
    expect(track.body.departure.driverLocation?.lat).toBe(-4.04);
    expect(track.body.departure.status).toBe("boarding");

    const completed = await request(app)
      .patch(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/status`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({ status: "completed" });
    expect(completed.status).toBe(200);

    const locAfter = await request(app)
      .patch(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/location`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({ lat: -4.05, lng: 39.73 });
    expect(locAfter.status).toBe(409);
    expect(locAfter.body.error?.code).toBe("DEPARTURE_NOT_ACTIVE");
  });
});
