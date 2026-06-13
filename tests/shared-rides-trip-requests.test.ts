import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/lib/openapi.js";
import { getNairobiParts, nairobiLocalToUtc, toNairobiIso } from "../src/lib/nairobi-time.js";
import { prisma } from "../src/lib/prisma.js";
import { seedSharedRidesCoast } from "../prisma/seeds/shared-rides-coast.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

const PASSENGER_A = "+254713200001";
const PASSENGER_B = "+254713200002";

/** Build a bookable POST body from coast seed (next future van for Nyali → SGR 08:00 train). */
async function nyaliToSgrTripRequestBody() {
  const slot = await prisma.sgrScheduleSlot.findFirst({
    where: {
      direction: "to_sgr",
      isActive: true,
      sgrEventTime: "08:00",
      vanDepartureTime: "06:00",
      pickupLocation: { slug: "nyali" },
      dropoffLocation: { slug: "sgr-miritini" },
    },
    include: { pickupLocation: true },
  });
  if (!slot) throw new Error("coast seed: Nyali 06:00 van slot missing");

  const now = new Date();
  const parts = getNairobiParts(now);
  const leadMs = 120 * 60_000;
  let vanAt: Date | null = null;
  let dayOffset = 0;
  for (dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const candidate = nairobiLocalToUtc(parts, slot.vanDepartureTime, dayOffset);
    if (candidate.getTime() > now.getTime() + leadMs) {
      vanAt = candidate;
      break;
    }
  }
  if (!vanAt) {
    vanAt = nairobiLocalToUtc(parts, slot.vanDepartureTime, 1);
    dayOffset = 1;
  }

  const depParts = getNairobiParts(vanAt);
  const departureDate = `${depParts.year}-${String(depParts.month).padStart(2, "0")}-${String(depParts.day).padStart(2, "0")}`;

  return {
    sgrScheduleSlotId: slot.id,
    direction: "to_sgr" as const,
    corridorLocationId: slot.pickupLocationId,
    departureDate,
    vanDepartureAt: toNairobiIso(vanAt),
    seatsRequested: 1,
  };
}

async function loginPassenger(app: Express, phone: string): Promise<string> {
  const session = await createAuthSession(app, phone, "passenger");
  return session.sessionToken;
}

describe("Shared rides trip requests (Phase 2)", () => {
  it("registers OpenAPI paths for trip-requests", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/api/shared-rides/trip-requests"]).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/trip-requests/mine"]).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/trip-requests/{tripRequestId}"]?.patch).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/trip-requests/{tripRequestId}/cancel"]?.post).toBeDefined();
  });

  it("creates a trip request from a suggestion payload and lists mine", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const token = await loginPassenger(app, PASSENGER_A);

    const body = await nyaliToSgrTripRequestBody();
    expect(body.vanDepartureAt).toMatch(/\+03:00$/);

    const created = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...body,
        seatsRequested: 2,
        pickupNote: "Near City Mall gate",
      });
    expect(created.status).toBe(201);
    expect(created.body.tripRequest.status).toBe("open");
    expect(created.body.tripRequest.poolSeatsTotal).toBe(2);
    expect(created.body.tripRequest.requestedDepartureAt).toMatch(/\+03:00$/);
    expect(created.body.reservation.seatsRequested).toBe(2);
    expect(created.body.reservation.pickupNote).toBe("Near City Mall gate");

    const tripRequestId = created.body.tripRequest.id as string;

    const mine = await request(app)
      .get("/api/shared-rides/trip-requests/mine")
      .set("Authorization", `Bearer ${token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].tripRequest.id).toBe(tripRequestId);

    const tokenB = await loginPassenger(app, PASSENGER_B);
    const joined = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ ...body, seatsRequested: 1 });
    expect(joined.status).toBe(201);
    expect(joined.body.tripRequest.id).toBe(tripRequestId);
    expect(joined.body.tripRequest.poolSeatsTotal).toBe(3);
  });

  it("returns 403 when a driver creates a trip request", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const driverToken = (
      await createAuthSession(app, "+254713200003", "driver", { name: "Shared Driver" })
    ).sessionToken;

    const res = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${driverToken}`)
      .send({
        sgrScheduleSlotId: "x",
        direction: "to_sgr",
        corridorLocationId: "y",
        departureDate: "2099-01-01",
        vanDepartureAt: new Date(Date.now() + 86400000).toISOString(),
        seatsRequested: 1,
      });
    expect(res.status).toBe(403);
  });

  it("returns 400 when corridor does not match the slot", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const token = await loginPassenger(app, "+254713200004");

    const body = await nyaliToSgrTripRequestBody();
    const diani = await prisma.corridorLocation.findUnique({ where: { slug: "diani" } });
    expect(diani).not.toBeNull();

    const res = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...body,
        corridorLocationId: diani!.id,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CORRIDOR_MISMATCH");
  });

  it("returns 409 when passenger requests the same van departure from another corridor", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const token = await loginPassenger(app, "+254713200006");

    const nyaliBody = await nyaliToSgrTripRequestBody();
    const created = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...nyaliBody, seatsRequested: 1 });
    expect(created.status).toBe(201);

    const diani = await prisma.sgrScheduleSlot.findFirst({
      where: {
        direction: "to_sgr",
        isActive: true,
        sgrEventTime: "08:00",
        vanDepartureTime: "06:00",
        pickupLocation: { slug: "diani" },
        dropoffLocation: { slug: "sgr-miritini" },
      },
      include: { pickupLocation: true },
    });
    expect(diani).not.toBeNull();

    const duplicate = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sgrScheduleSlotId: diani!.id,
        direction: "to_sgr",
        corridorLocationId: diani!.pickupLocationId,
        departureDate: nyaliBody.departureDate,
        vanDepartureAt: nyaliBody.vanDepartureAt,
        seatsRequested: 1,
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("TRIP_REQUEST_DUPLICATE");
  });

  it("updates and cancels an open trip request reservation", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const token = await loginPassenger(app, "+254713200005");
    const body = await nyaliToSgrTripRequestBody();

    const created = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...body, seatsRequested: 1, pickupNote: "Gate A" });
    expect(created.status).toBe(201);
    const tripRequestId = created.body.tripRequest.id as string;

    const updated = await request(app)
      .patch(`/api/shared-rides/trip-requests/${tripRequestId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ seatsRequested: 2, pickupNote: "Nyali Road" });
    expect(updated.status).toBe(200);
    expect(updated.body.reservation.seatsRequested).toBe(2);
    expect(updated.body.reservation.pickupNote).toBe("Nyali Road");
    expect(updated.body.tripRequest.poolSeatsTotal).toBe(2);

    const cancelled = await request(app)
      .post(`/api/shared-rides/trip-requests/${tripRequestId}/cancel`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.reservation.status).toBe("cancelled");
    expect(cancelled.body.tripRequest.status).toBe("cancelled");

    const mine = await request(app)
      .get("/api/shared-rides/trip-requests/mine")
      .set("Authorization", `Bearer ${token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(0);
  });
});
