import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { placeSnapshotJson, persistPlacePair } from "../src/lib/place-persist.js";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession } from "./helpers.js";
import request from "supertest";

describe("place persistence (Phase 2)", () => {
  it("persistPlacePair creates Place rows and JSON snapshots", async () => {
    const result = await persistPlacePair(
      prisma,
      { label: "Nyali Beach", lat: -4.04, lng: 39.71, placeId: "g-nyali" },
      { label: "JKIA", lat: -1.32, lng: 36.93 },
    );

    expect(result.pickupPlaceId).toBeTruthy();
    expect(result.dropoffPlaceId).toBeTruthy();
    expect(result.pickup).toMatchObject({ label: "Nyali Beach", lat: -4.04, lng: 39.71, placeId: "g-nyali" });
    expect(result.dropoff).toMatchObject({ label: "JKIA", lat: -1.32, lng: 36.93 });

    const pickupRow = await prisma.place.findUniqueOrThrow({ where: { id: result.pickupPlaceId } });
    expect(pickupRow.label).toBe("Nyali Beach");
    expect(pickupRow.externalPlaceId).toBe("g-nyali");
  });

  it("placeSnapshotJson omits placeId when absent", () => {
    const json = placeSnapshotJson({ label: "CBD", lat: 1, lng: 2 });
    expect(json).toEqual({ label: "CBD", lat: 1, lng: 2 });
    expect("placeId" in json).toBe(false);
  });

  it("createBooking dual-writes pickupPlaceId and JSON", async () => {
    const app = buildTestApp();
    const phone = `+2547${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, "0")}`;
    const session = await createAuthSession(app, phone, "passenger");

    const res = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${session.sessionToken}`)
      .send({
        pickup: { label: "Pickup A", lat: -1.28, lng: 36.82 },
        dropoff: { label: "Dropoff B", lat: -1.29, lng: 36.83 },
        seats: [1],
      });

    expect(res.status).toBe(201);
    const bookingId = res.body.booking.id as string;

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.pickupPlaceId).toBeTruthy();
    expect(row.dropoffPlaceId).toBeTruthy();
    expect(row.pickup).toMatchObject({ label: "Pickup A", lat: -1.28, lng: 36.82 });
    expect(row.dropoff).toMatchObject({ label: "Dropoff B", lat: -1.29, lng: 36.83 });

    const pickupPlace = await prisma.place.findUniqueOrThrow({ where: { id: row.pickupPlaceId! } });
    expect(pickupPlace.label).toBe("Pickup A");
  });

  it("requestRide dual-writes pickupPlaceId and JSON", async () => {
    const app = buildTestApp();
    const passengerPhone = `+2547${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, "0")}`;
    const driverPhone = `+2547${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, "0")}`;

    await createAuthSession(app, passengerPhone, "passenger");
    const driver = await createAuthSession(app, driverPhone, "driver");

    const passenger = await prisma.user.findFirstOrThrow({
      where: { phone: passengerPhone, role: UserRole.passenger },
    });

    await prisma.driverProfile.update({
      where: { userId: driver.user.id },
      data: { isOnline: true, location: { lat: -1.28, lng: 36.82, updatedAt: new Date().toISOString() } },
    });

    const loginPassenger = await request(app)
      .post("/api/auth/login")
      .send({ identifier: passengerPhone, password: "TestPass123", role: "passenger" });

    const res = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${loginPassenger.body.sessionToken}`)
      .send({
        pickup: { label: "Ride Pickup", lat: -1.28, lng: 36.82 },
        dropoff: { label: "Ride Dropoff", lat: -1.29, lng: 36.83 },
      });

    expect(res.status).toBe(201);
    const rideId = res.body.ride.id as string;

    const row = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(row.passengerId).toBe(passenger.id);
    expect(row.pickupPlaceId).toBeTruthy();
    expect(row.dropoffPlaceId).toBeTruthy();
    expect(row.pickup).toMatchObject({ label: "Ride Pickup" });
  });
});
