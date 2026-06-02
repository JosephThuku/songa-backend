import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/lib/openapi.js";
import { prisma } from "../src/lib/prisma.js";
import { seedSharedRidesCoast } from "../prisma/seeds/shared-rides-coast.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

const PASSENGER_A = "+254713300001";
const PASSENGER_B = "+254713300002";
const DEMO_DEPARTURE_ID = "dep_seed_nyali_sgr_morning";

async function loginPassenger(app: Express, phone: string): Promise<string> {
  const session = await createAuthSession(app, phone, "passenger");
  return session.sessionToken;
}

describe("Shared rides departure seats and booking (Phase 3)", () => {
  it("registers OpenAPI paths for departure booking", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/api/shared-rides/departures/{departureId}"]).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/departures/{departureId}/seats/reserve"]).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/departures/{departureId}/bookings"]).toBeDefined();
  });

  it("reserves seats, creates booking, pays, and marks seats paid", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const driverSession = await createAuthSession(app, "+254713300102", "driver");
    await prisma.sharedDeparture.update({
      where: { id: DEMO_DEPARTURE_ID },
      data: { driverId: driverSession.user.id },
    });
    const token = await loginPassenger(app, PASSENGER_A);
    const devAutoPay = process.env.ALLOW_DEV_PAYMENT_CONFIRM === "true";

    const detailBefore = await request(app)
      .get(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detailBefore.status).toBe(200);
    const seat3 = detailBefore.body.departure.seats.find((s: { seatNumber: number }) => s.seatNumber === 3);
    expect(seat3?.status).toBe("available");

    const reserved = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/seats/reserve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ seatNumbers: [3, 4] });
    expect(reserved.status).toBe(200);
    expect(reserved.body.reservedUntil).toMatch(/\+03:00$/);
    expect(reserved.body.departure.seats.filter((s: { isMine: boolean }) => s.isMine).map((s: { seatNumber: number }) => s.seatNumber)).toEqual([
      3, 4,
    ]);

    const bookingRes = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({ seatNumbers: [3, 4] });
    expect(bookingRes.status).toBe(201);
    expect(bookingRes.body.booking).toMatchObject({
      product: "shared_sgr",
      sharedDepartureId: DEMO_DEPARTURE_ID,
      status: "pending_payment",
      seats: [3, 4],
      subtotal: 700,
      platformFee: 0,
      total: 700,
      currency: "KES",
    });

    const pay = await request(app)
      .post(`/api/bookings/${bookingRes.body.booking.id}/pay`)
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "flutterwave" });
    expect(pay.status).toBe(200);
    if (devAutoPay) {
      expect(pay.body.payment.status).toBe("succeeded");
    }

    const seats = await prisma.sharedDepartureSeat.findMany({
      where: { departureId: DEMO_DEPARTURE_ID, seatNumber: { in: [3, 4] } },
    });
    if (devAutoPay) {
      expect(seats.every((s) => s.status === "paid")).toBe(true);

      const walletTx = await prisma.walletTransaction.findFirst({
        where: {
          type: "shared_booking_credit",
          metadata: { path: "$.bookingId", equals: bookingRes.body.booking.id },
        },
      });
      expect(walletTx).toMatchObject({
        driverId: driverSession.user.id,
        amount: 700,
        status: "posted",
      });
    } else {
      expect(seats.every((s) => s.bookingId === bookingRes.body.booking.id)).toBe(true);
    }
  });

  it("rejects reserving a seat held by another passenger", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const tokenA = await loginPassenger(app, PASSENGER_A);
    const tokenB = await loginPassenger(app, PASSENGER_B);

    const hold = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/seats/reserve`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ seatNumbers: [5] });
    expect(hold.status).toBe(200);

    const conflict = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/seats/reserve`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ seatNumbers: [5] });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("SEAT_NOT_AVAILABLE");
  });

  it("releases held seats", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const token = await loginPassenger(app, PASSENGER_A);

    await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/seats/reserve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ seatNumbers: [6] });

    const released = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/seats/release`)
      .set("Authorization", `Bearer ${token}`)
      .send({ seatNumbers: [6] });
    expect(released.status).toBe(200);
    const seat6 = released.body.departure.seats.find((s: { seatNumber: number }) => s.seatNumber === 6);
    expect(seat6?.status).toBe("available");
    expect(seat6?.isMine).toBe(false);
  });
});
