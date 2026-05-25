import cuid from "cuid";
import { BookingMode } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { onRideOffer } from "../src/lib/ride-events.js";
import { redispatchRideIfPending } from "../src/services/ride.service.js";

describe("redispatchRideIfPending", () => {
  it("no-ops when a driver is already assigned", async () => {
    const passenger = await prisma.user.create({
      data: { phone: `+254790${Date.now()}`, role: "passenger", phoneVerified: true },
    });
    const driver = await prisma.user.create({
      data: { phone: `+254791${Date.now()}`, role: "driver", phoneVerified: true },
    });
    const ride = await prisma.ride.create({
      data: {
        id: `ride_${cuid()}`,
        passengerId: passenger.id,
        driverId: driver.id,
        phase: "driver_accepted",
        bookingMode: BookingMode.pay_on_arrival,
        prepaid: false,
        price: 500,
        pickup: { label: "A", lat: -1.27, lng: 36.8 },
        dropoff: { label: "B", lat: -1.28, lng: 36.81 },
      },
    });

    const offers: string[] = [];
    const unsub = onRideOffer((event) => offers.push(event.driverId));
    await redispatchRideIfPending(ride.id);
    unsub();

    expect(offers).toHaveLength(0);
  });

  it("no-ops when ride is not in finding_driver", async () => {
    const passenger = await prisma.user.create({
      data: { phone: `+254792${Date.now()}`, role: "passenger", phoneVerified: true },
    });
    const ride = await prisma.ride.create({
      data: {
        id: `ride_${cuid()}`,
        passengerId: passenger.id,
        phase: "cancelled",
        bookingMode: BookingMode.pay_on_arrival,
        prepaid: false,
        price: 500,
        pickup: { label: "A", lat: -1.27, lng: 36.8 },
        dropoff: { label: "B", lat: -1.28, lng: 36.81 },
      },
    });

    const offers: string[] = [];
    const unsub = onRideOffer((event) => offers.push(event.driverId));
    await redispatchRideIfPending(ride.id);
    unsub();
    expect(offers).toHaveLength(0);
  });
});
