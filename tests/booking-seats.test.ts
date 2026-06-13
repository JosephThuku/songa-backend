import cuid from "cuid";
import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  normalizeSeatNumbers,
  persistBookingSeats,
  seatNumbersFromBooking,
  serializeBookingSeats,
} from "../src/lib/booking-seats.js";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession } from "./helpers.js";
import request from "supertest";

describe("booking-seats helpers", () => {
  it("normalizeSeatNumbers dedupes and sorts", () => {
    expect(normalizeSeatNumbers([3, 1, 2, 2])).toEqual([1, 2, 3]);
  });

  it("seatNumbersFromBooking prefers seatRows over legacy string", () => {
    expect(
      seatNumbersFromBooking({
        seats: "9,8",
        seatRows: [{ seatNumber: 2 }, { seatNumber: 5 }],
      }),
    ).toEqual([2, 5]);
  });

  it("seatNumbersFromBooking falls back to legacy string", () => {
    expect(seatNumbersFromBooking({ seats: "4,1,4" })).toEqual([1, 4]);
  });
});

describe("BookingSeat dual-write", () => {
  it("createBooking writes BookingSeat rows and legacy seats string", async () => {
    const app = buildTestApp();
    const phone = `+2547${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, "0")}`;
    const session = await createAuthSession(app, phone, "passenger");

    const res = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${session.sessionToken}`)
      .send({
        pickup: { label: "A", lat: -1.28, lng: 36.82 },
        dropoff: { label: "B", lat: -1.29, lng: 36.83 },
        seats: [2, 1],
      });

    expect(res.status).toBe(201);
    expect(res.body.booking.seats).toEqual([1, 2]);

    const bookingId = res.body.booking.id as string;
    const rows = await prisma.bookingSeat.findMany({
      where: { bookingId },
      orderBy: { seatNumber: "asc" },
    });
    expect(rows.map((r) => r.seatNumber)).toEqual([1, 2]);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.seats).toBe(serializeBookingSeats([1, 2]));
  });

  it("persistBookingSeats links sharedDepartureSeatId when departureId provided", async () => {
    const driver = await prisma.user.create({
      data: {
        phone: `+2547${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, "0")}`,
        role: UserRole.driver,
      },
    });
    const pickup = await prisma.corridorLocation.create({
      data: { slug: `bs-p-${cuid()}`, name: "BS Pickup", lat: -4, lng: 39 },
    });
    const dropoff = await prisma.corridorLocation.create({
      data: { slug: `bs-d-${cuid()}`, name: "BS Dropoff", lat: -4.1, lng: 39.1 },
    });
    const departure = await prisma.sharedDeparture.create({
      data: {
        id: `dep-bs-${cuid()}`,
        driverId: driver.id,
        pickupLocationId: pickup.id,
        dropoffLocationId: dropoff.id,
        departureAt: new Date(Date.now() + 3_600_000),
        pricePerSeat: 350,
        capacity: 14,
      },
    });
    const departureSeat = await prisma.sharedDepartureSeat.create({
      data: {
        departureId: departure.id,
        seatNumber: 3,
        seatLabel: "A3",
        status: "reserved",
      },
    });

    const passenger = await prisma.user.create({
      data: {
        phone: `+2547${Math.floor(Math.random() * 1e8)
          .toString()
          .padStart(8, "0")}`,
        role: UserRole.passenger,
      },
    });
    const bookingId = `BKG-${cuid()}`;
    await prisma.booking.create({
      data: {
        id: bookingId,
        passengerId: passenger.id,
        product: "shared_sgr",
        sharedDepartureId: departure.id,
        seats: "3",
        subtotal: 350,
        platformFee: 50,
        total: 400,
        pickup: { label: "A", lat: 1, lng: 2 },
        dropoff: { label: "B", lat: 3, lng: 4 },
      },
    });

    await persistBookingSeats(prisma, bookingId, [3], { departureId: departure.id });

    const row = await prisma.bookingSeat.findFirstOrThrow({ where: { bookingId, seatNumber: 3 } });
    expect(row.sharedDepartureSeatId).toBe(departureSeat.id);
  });
});
