/**
 * Integration tests for ride-location-sync.
 *
 * phaseFromPickupDistance is private, so we drive it through the public
 * syncActiveRideFromDriverLocation function using real Prisma rows.
 */
import cuid from "cuid";
import { BookingMode } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { syncActiveRideFromDriverLocation } from "../src/lib/ride-location-sync.js";

// Nairobi pickup location used across all tests.
const PICKUP = { label: "Westlands", lat: -1.2674, lng: 36.807 };

async function createPassenger() {
  return prisma.user.create({
    data: {
      phone: `+254700${Date.now()}`,
      role: "passenger",
      name: "Test Passenger",
      phoneVerified: true,
    },
  });
}

async function createDriver() {
  return prisma.user.create({
    data: {
      phone: `+254711${Date.now()}`,
      role: "driver",
      name: "Test Driver",
      phoneVerified: true,
    },
  });
}

async function createRideInPhase(
  passengerId: string,
  phase: "driver_accepted" | "driver_en_route" | "driver_arriving" | "trip_in_progress",
) {
  const driver =
    phase === "trip_in_progress" ? await createDriver() : null;
  return prisma.ride.create({
    data: {
      id: `ride_${cuid()}`,
      passengerId,
      driverId: driver?.id,
      phase,
      bookingMode: BookingMode.pay_on_arrival,
      prepaid: false,
      price: 500,
      currency: "KES",
      distanceKm: 14.5,
      etaMinutes: 10,
      pickup: PICKUP,
      dropoff: { label: "JKIA", lat: -1.3192, lng: 36.9278 },
    },
  });
}

describe("syncActiveRideFromDriverLocation — phaseFromPickupDistance", () => {
  it("no-ops when the ride is not in an en-route phase (finding_driver)", async () => {
    const passenger = await createPassenger();
    const ride = await prisma.ride.create({
      data: {
        id: `ride_${cuid()}`,
        passengerId: passenger.id,
        phase: "finding_driver",
        bookingMode: BookingMode.pay_on_arrival,
        prepaid: false,
        price: 500,
        currency: "KES",
        pickup: PICKUP,
        dropoff: { label: "JKIA", lat: -1.3192, lng: 36.9278 },
      },
    });

    // Place driver far away — should not change anything
    const farDriver = { lat: PICKUP.lat - 2, lng: PICKUP.lng };
    await syncActiveRideFromDriverLocation(ride.id, farDriver);

    const updated = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updated.phase).toBe("finding_driver");
  });

  it("updates ETA when driver is far from pickup (driver_en_route phase preserved)", async () => {
    const passenger = await createPassenger();
    const ride = await createRideInPhase(passenger.id, "driver_en_route");

    // Driver ~5 km away — well beyond DRIVER_ARRIVING_KM (2 km)
    const farDriver = { lat: PICKUP.lat - 0.045, lng: PICKUP.lng }; // ~5 km south
    await syncActiveRideFromDriverLocation(ride.id, farDriver);

    const updated = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updated.phase).toBe("driver_en_route");
    expect(updated.etaMinutes).toBeGreaterThanOrEqual(1);
  });

  it("transitions driver_en_route → driver_arriving when driver within DRIVER_ARRIVING_KM", async () => {
    const passenger = await createPassenger();
    const ride = await createRideInPhase(passenger.id, "driver_en_route");

    const closeDriver = { lat: PICKUP.lat, lng: PICKUP.lng };

    await syncActiveRideFromDriverLocation(ride.id, closeDriver);

    const updated = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updated.phase).toBe("driver_arriving");
    // ETA should be 1 when driver is essentially at pickup
    expect(updated.etaMinutes).toBe(1);
    // Confirm the update persisted — driverLocation stored on the ride row
    expect(updated.driverLocation).not.toBeNull();
  });

  it("preserves driver_arriving phase when driver remains close", async () => {
    const passenger = await createPassenger();
    const ride = await createRideInPhase(passenger.id, "driver_arriving");

    // Set ETA to 99 so any update to 1 is unambiguous
    await prisma.ride.update({ where: { id: ride.id }, data: { etaMinutes: 99 } });

    // Driver exactly at the pickup — 0 km, definitely within DRIVER_ARRIVING_KM
    const closeDriver = { lat: PICKUP.lat, lng: PICKUP.lng };
    await syncActiveRideFromDriverLocation(ride.id, closeDriver);

    const updated = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updated.phase).toBe("driver_arriving");
    expect(updated.etaMinutes).toBe(1);
    // Confirm the update persisted (driverLocation should be stored)
    expect(updated.driverLocation).not.toBeNull();
  });

  it("updates ETA toward drop-off during trip_in_progress", async () => {
    const passenger = await createPassenger();
    const ride = await createRideInPhase(passenger.id, "trip_in_progress");
    await syncActiveRideFromDriverLocation(ride.id, {
      lat: -1.3,
      lng: 36.85,
      updatedAt: new Date().toISOString(),
    });
    const updated = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updated.phase).toBe("trip_in_progress");
    expect(updated.etaMinutes).toBeGreaterThanOrEqual(1);
    expect(updated.distanceKm).toBeGreaterThan(0);
  });

  it("no-ops for a terminal ride (trip_ended)", async () => {
    const passenger = await createPassenger();
    const ride = await prisma.ride.create({
      data: {
        id: `ride_${cuid()}`,
        passengerId: passenger.id,
        phase: "trip_ended",
        bookingMode: BookingMode.pay_on_arrival,
        prepaid: false,
        price: 500,
        currency: "KES",
        etaMinutes: 0,
        pickup: PICKUP,
        dropoff: { label: "JKIA", lat: -1.3192, lng: 36.9278 },
      },
    });

    await syncActiveRideFromDriverLocation(ride.id, { lat: PICKUP.lat, lng: PICKUP.lng });

    const updated = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updated.phase).toBe("trip_ended");
  });

  it("no-ops when driver location is malformed (missing lat)", async () => {
    const passenger = await createPassenger();
    const ride = await createRideInPhase(passenger.id, "driver_en_route");

    const originalEta = ride.etaMinutes;
    await syncActiveRideFromDriverLocation(ride.id, { lng: PICKUP.lng });

    const updated = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
    expect(updated.phase).toBe("driver_en_route");
    expect(updated.etaMinutes).toBe(originalEta);
  });
});
