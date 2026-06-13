import cuid from "cuid";
import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";

async function createPassenger() {
  return prisma.user.create({
    data: {
      phone: `+2547${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, "0")}`,
      role: UserRole.passenger,
      name: "FK Test Passenger",
    },
  });
}

async function createDriverWithVehicle() {
  const user = await prisma.user.create({
    data: {
      phone: `+2547${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, "0")}`,
      role: UserRole.driver,
      name: "FK Test Driver",
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      type: "Van",
      make: "Toyota",
      model: "Hiace",
      registration: `KFK${cuid().slice(0, 5).toUpperCase()}`,
      color: "White",
      seats: 14,
    },
  });
  await prisma.driverProfile.create({
    data: { userId: user.id, vehicleId: vehicle.id },
  });
  return { user, vehicle };
}

describe("database integrity foreign keys", () => {
  it("rejects Ride.bookingId pointing at a missing booking", async () => {
    const passenger = await createPassenger();

    await expect(
      prisma.ride.create({
        data: {
          id: `ride-fk-${cuid()}`,
          passengerId: passenger.id,
          bookingMode: "pay_on_arrival",
          price: 500,
          pickup: { label: "A", lat: -4.04, lng: 39.71 },
          dropoff: { label: "B", lat: -4.05, lng: 39.72 },
          bookingId: "BKG-does-not-exist",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects SharedDepartureSeat.bookingId pointing at a missing booking", async () => {
    const { user: driver, vehicle } = await createDriverWithVehicle();
    const passenger = await createPassenger();

    const pickup = await prisma.corridorLocation.create({
      data: { slug: `fk-zone-a-${cuid()}`, name: "FK Zone A", lat: -4.04, lng: 39.71 },
    });
    const dropoff = await prisma.corridorLocation.create({
      data: { slug: `fk-zone-b-${cuid()}`, name: "FK Zone B", lat: -4.05, lng: 39.72 },
    });
    const slot = await prisma.sgrScheduleSlot.create({
      data: {
        pickupLocationId: pickup.id,
        dropoffLocationId: dropoff.id,
        direction: "to_sgr",
        trainService: "inter_county",
        sgrEventTime: "08:00",
        vanDepartureTime: "06:00",
        suggestedPricePerSeat: 350,
      },
    });
    const departure = await prisma.sharedDeparture.create({
      data: {
        id: `dep-fk-${cuid()}`,
        driverId: driver.id,
        vehicleId: vehicle.id,
        pickupLocationId: pickup.id,
        dropoffLocationId: dropoff.id,
        sgrScheduleSlotId: slot.id,
        departureAt: new Date(Date.now() + 3_600_000),
        pricePerSeat: 350,
        capacity: 14,
      },
    });

    await expect(
      prisma.sharedDepartureSeat.create({
        data: {
          departureId: departure.id,
          seatNumber: 1,
          seatLabel: "A1",
          status: "reserved",
          reservedById: passenger.id,
          bookingId: "BKG-missing-seat",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects WalletTransaction.rideId pointing at a missing ride", async () => {
    const { user: driver } = await createDriverWithVehicle();

    await expect(
      prisma.walletTransaction.create({
        data: {
          id: `tx-fk-${cuid()}`,
          driverId: driver.id,
          rideId: "ride-does-not-exist",
          type: "credit",
          label: "Test",
          amount: 100,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("allows null optional foreign keys", async () => {
    const passenger = await createPassenger();

    const ride = await prisma.ride.create({
      data: {
        id: `ride-fk-null-${cuid()}`,
        passengerId: passenger.id,
        bookingMode: "pay_on_arrival",
        price: 500,
        pickup: { label: "A", lat: -4.04, lng: 39.71 },
        dropoff: { label: "B", lat: -4.05, lng: 39.72 },
        bookingId: null,
      },
    });

    expect(ride.bookingId).toBeNull();
  });
});
