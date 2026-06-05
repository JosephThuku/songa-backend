import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/lib/openapi.js";
import { getNairobiParts, nairobiLocalToUtc, toNairobiIso } from "../src/lib/nairobi-time.js";
import { prisma } from "../src/lib/prisma.js";
import { seedSharedRidesCoast } from "../prisma/seeds/shared-rides-coast.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const PASSENGER_PHONE = "+254713400001";
const DRIVER_A_PHONE = "+254713400101";
const DRIVER_B_PHONE = "+254713400102";

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
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const candidate = nairobiLocalToUtc(parts, slot.vanDepartureTime, dayOffset);
    if (candidate.getTime() > now.getTime() + leadMs) {
      vanAt = candidate;
      break;
    }
  }
  if (!vanAt) vanAt = nairobiLocalToUtc(parts, slot.vanDepartureTime, 1);

  const depParts = getNairobiParts(vanAt);
  const departureDate = `${depParts.year}-${String(depParts.month).padStart(2, "0")}-${String(depParts.day).padStart(2, "0")}`;

  return {
    body: {
      sgrScheduleSlotId: slot.id,
      direction: "to_sgr" as const,
      corridorLocationId: slot.pickupLocationId,
      departureDate,
      vanDepartureAt: toNairobiIso(vanAt),
      seatsRequested: 2,
      pickupNote: "City Mall",
    },
    slot,
    vanAt,
  };
}

describe("Shared rides driver supply (Phase 4)", () => {
  it("registers OpenAPI paths for driver supply", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/api/shared-rides/trip-requests"]?.get).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/trip-requests/{tripRequestId}/join"]?.post).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/departures"]?.post).toBeDefined();
  });

  it("lists open pools, join creates departure, notifies passengers, second join fails", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const passengerSession = await createAuthSession(app, PASSENGER_PHONE, "passenger");
    const driverA = await createAuthSession(app, DRIVER_A_PHONE, "driver");
    const driverB = await createAuthSession(app, DRIVER_B_PHONE, "driver");
    await setupDriverForDispatch(app, driverA.sessionToken, { type: "Van", seats: 14 });
    await setupDriverForDispatch(app, driverB.sessionToken, { type: "Van", seats: 14 });

    const { body: tripBody } = await nyaliToSgrTripRequestBody();
    const created = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${passengerSession.sessionToken}`)
      .send(tripBody);
    expect(created.status).toBe(201);
    const tripRequestId = created.body.tripRequest.id as string;

    const board = await request(app)
      .get("/api/shared-rides/trip-requests?direction=to_sgr&corridorLocationSlug=nyali")
      .set("Authorization", `Bearer ${driverA.sessionToken}`);
    expect(board.status).toBe(200);
    expect(board.body.items.length).toBeGreaterThanOrEqual(1);
    expect(board.body.items[0].tripRequest.id).toBe(tripRequestId);
    expect(board.body.items[0].poolSeatsTotal).toBe(2);

    const joined = await request(app)
      .post(`/api/shared-rides/trip-requests/${tripRequestId}/join`)
      .set("Authorization", `Bearer ${driverA.sessionToken}`);
    expect(joined.status).toBe(200);
    expect(joined.body.tripRequest.status).toBe("matched");
    expect(joined.body.departure).toMatchObject({
      driverId: driverA.user.id,
      capacity: 14,
      pricePerSeat: expect.any(Number),
    });

    const seats = await prisma.sharedDepartureSeat.count({
      where: { departureId: joined.body.departure.id },
    });
    expect(seats).toBe(14);

    const depRow = await prisma.sharedDeparture.findUnique({
      where: { id: joined.body.departure.id as string },
      select: { vehicleId: true, driverId: true },
    });
    expect(depRow?.driverId).toBe(driverA.user.id);
    expect(depRow?.vehicleId).toBeTruthy();

    const notifications = await prisma.notification.findMany({
      where: { userId: passengerSession.user.id, type: "shared_ride_matched" },
    });
    expect(notifications.length).toBeGreaterThanOrEqual(1);

    const conflict = await request(app)
      .post(`/api/shared-rides/trip-requests/${tripRequestId}/join`)
      .set("Authorization", `Bearer ${driverB.sessionToken}`);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("TRIP_REQUEST_NOT_OPEN");
  });

  it("driver sees reserved seats after passenger reserve and can advance lifecycle", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const passenger = await createAuthSession(app, PASSENGER_PHONE, "passenger");
    const driver = await createAuthSession(app, DRIVER_A_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 14 });

    const { body: tripBody } = await nyaliToSgrTripRequestBody();
    const created = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${passenger.sessionToken}`)
      .send(tripBody);
    const tripRequestId = created.body.tripRequest.id as string;

    const joined = await request(app)
      .post(`/api/shared-rides/trip-requests/${tripRequestId}/join`)
      .set("Authorization", `Bearer ${driver.sessionToken}`);
    const depId = joined.body.departure.id as string;

    await request(app)
      .post(`/api/shared-rides/departures/${depId}/seats/reserve`)
      .set("Authorization", `Bearer ${passenger.sessionToken}`)
      .send({ seatNumbers: [3] });

    const driverView = await request(app)
      .get(`/api/shared-rides/departures/${depId}`)
      .set("Authorization", `Bearer ${driver.sessionToken}`);
    expect(driverView.status).toBe(200);
    expect(driverView.body.departure.seatSummary).toMatchObject({
      reserved: 1,
      available: 13,
    });
    const seat3 = driverView.body.departure.seats.find((s: { seatNumber: number }) => s.seatNumber === 3);
    expect(seat3?.status).toBe("reserved");
    expect(seat3?.occupant?.passengerId).toBe(passenger.user.id);

    const boarding = await request(app)
      .patch(`/api/shared-rides/departures/${depId}/status`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({ status: "boarding" });
    expect(boarding.status).toBe(200);
    expect(boarding.body.departure.status).toBe("boarding");

    const completed = await request(app)
      .patch(`/api/shared-rides/departures/${depId}/status`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({ status: "completed" });
    expect(completed.status).toBe(200);
    expect(completed.body.departure.status).toBe("completed");
  });

  it("rejects publish when vehicle is not eligible for shared (car, too few seats)", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const driver = await createAuthSession(app, DRIVER_A_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Car", seats: 6 });

    const slot = await prisma.sgrScheduleSlot.findFirst({
      where: {
        direction: "to_sgr",
        pickupLocation: { slug: "nyali" },
        dropoffLocation: { slug: "sgr-miritini" },
        trainService: "inter_county",
        vanDepartureTime: "06:00",
      },
    });
    if (!slot) throw new Error("nyali slot missing");

    const parts = getNairobiParts(new Date());
    const vanAt = nairobiLocalToUtc(parts, slot.vanDepartureTime, 1);

    const published = await request(app)
      .post("/api/shared-rides/departures")
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({
        sgrScheduleSlotId: slot.id,
        departureAt: toNairobiIso(vanAt),
        pricePerSeat: 350,
      });
    expect(published.status).toBe(409);
    expect(published.body.error.code).toBe("VEHICLE_NOT_ELIGIBLE_FOR_SHARED");
  });

  it("driver publishes a standalone departure", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const driver = await createAuthSession(app, DRIVER_A_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 10 });

    const slot = await prisma.sgrScheduleSlot.findFirst({
      where: {
        direction: "to_sgr",
        pickupLocation: { slug: "diani" },
        dropoffLocation: { slug: "sgr-miritini" },
        trainService: "express",
        vanDepartureTime: "12:00",
      },
    });
    if (!slot) throw new Error("diani express slot missing");

    const parts = getNairobiParts(new Date());
    const vanAt = nairobiLocalToUtc(parts, slot.vanDepartureTime, 1);

    const published = await request(app)
      .post("/api/shared-rides/departures")
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({
        sgrScheduleSlotId: slot.id,
        departureAt: toNairobiIso(vanAt),
        pricePerSeat: 700,
      });
    expect(published.status).toBe(201);
    expect(published.body.departure).toMatchObject({
      driverId: driver.user.id,
      capacity: 10,
      pricePerSeat: 700,
      routeLabel: expect.stringContaining("Diani"),
    });
  });

  it("driver can publish earlier than the timetable van time", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const driver = await createAuthSession(app, DRIVER_A_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 10 });

    const slot = await prisma.sgrScheduleSlot.findFirst({
      where: {
        direction: "to_sgr",
        pickupLocation: { slug: "nyali" },
        vanDepartureTime: "06:00",
      },
    });
    if (!slot) throw new Error("nyali 06:00 slot missing");

    const parts = getNairobiParts(new Date());
    const vanAt = nairobiLocalToUtc(parts, slot.vanDepartureTime, 1);
    const earlyAt = new Date(vanAt.getTime() - 30 * 60_000);

    const published = await request(app)
      .post("/api/shared-rides/departures")
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({
        sgrScheduleSlotId: slot.id,
        departureAt: toNairobiIso(earlyAt),
        pricePerSeat: 350,
      });
    expect(published.status).toBe(201);
    expect(new Date(published.body.departure.departureAt).getTime()).toBe(earlyAt.getTime());
  });

  it("driver can cancel a boarding departure and release seats", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const passenger = await createAuthSession(app, PASSENGER_PHONE, "passenger");
    const driver = await createAuthSession(app, DRIVER_A_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 14 });

    const { body: tripBody } = await nyaliToSgrTripRequestBody();
    const created = await request(app)
      .post("/api/shared-rides/trip-requests")
      .set("Authorization", `Bearer ${passenger.sessionToken}`)
      .send(tripBody);
    const tripRequestId = created.body.tripRequest.id as string;

    const joined = await request(app)
      .post(`/api/shared-rides/trip-requests/${tripRequestId}/join`)
      .set("Authorization", `Bearer ${driver.sessionToken}`);
    const depId = joined.body.departure.id as string;

    await request(app)
      .patch(`/api/shared-rides/departures/${depId}/status`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({ status: "boarding" });

    await request(app)
      .post(`/api/shared-rides/departures/${depId}/seats/reserve`)
      .set("Authorization", `Bearer ${passenger.sessionToken}`)
      .send({ seatNumbers: [4] });

    const cancelled = await request(app)
      .patch(`/api/shared-rides/departures/${depId}/status`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({ status: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.departure.status).toBe("cancelled");
    expect(cancelled.body.departure.seatSummary.reserved).toBe(0);

    const seat4 = cancelled.body.departure.seats.find((s: { seatNumber: number }) => s.seatNumber === 4);
    expect(seat4?.status).toBe("available");
  });
});
