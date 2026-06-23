import { afterEach, describe, expect, it } from "vitest";
import cuid from "cuid";
import { prisma } from "../src/lib/prisma.js";
import {
  cancelPassengerBooking,
  expireStaleUnpaidSharedSgrBookings,
} from "../src/services/booking.service.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

describe("shared SGR unpaid booking expiry", () => {
  const phones: string[] = [];

  afterEach(async () => {
    for (const phone of phones.splice(0)) {
      const user = await prisma.user.findFirst({ where: { phone } });
      if (!user) continue;
      await prisma.booking.deleteMany({ where: { passengerId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("cancels pending shared_sgr bookings older than 25 minutes", async () => {
    const phone = `+2547133${Math.floor(Math.random() * 1e5)
      .toString()
      .padStart(5, "0")}`;
    phones.push(phone);
    const session = await createAuthSession(buildTestApp(), phone, "passenger");
    const bookingId = `BKG-${cuid()}`;

    await prisma.booking.create({
      data: {
        id: bookingId,
        passengerId: session.user.id,
        product: "shared_sgr",
        sharedDepartureId: null,
        status: "pending_payment",
        seats: "[9]",
        subtotal: 350,
        platformFee: 0,
        total: 350,
        pickup: { label: "Nyali", lat: -4, lng: 39 },
        dropoff: { label: "SGR", lat: -4.1, lng: 39.1 },
        createdAt: new Date(Date.now() - 26 * 60_000),
      },
    });

    const expired = await expireStaleUnpaidSharedSgrBookings(session.user.id);
    expect(expired).toBe(1);

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.status).toBe("cancelled");
  });

  it("cancels pending bookings for the signed-in passenger", async () => {
    const phone = `+2547133${Math.floor(Math.random() * 1e5)
      .toString()
      .padStart(5, "0")}`;
    phones.push(phone);
    const session = await createAuthSession(buildTestApp(), phone, "passenger");
    const bookingId = `BKG-${cuid()}`;

    await prisma.booking.create({
      data: {
        id: bookingId,
        passengerId: session.user.id,
        product: "on_demand",
        status: "pending_payment",
        seats: "[1]",
        subtotal: 500,
        platformFee: 50,
        total: 550,
        pickup: { label: "Nyali", lat: -4, lng: 39 },
        dropoff: { label: "SGR", lat: -4.1, lng: 39.1 },
      },
    });

    const result = await cancelPassengerBooking(bookingId, session.user.id);
    expect(result.booking.status).toBe("cancelled");
  });
});
