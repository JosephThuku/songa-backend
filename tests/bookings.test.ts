import type { Express } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

const PASSENGER_PHONE = "+254716000001";
const PASSENGER_2_PHONE = "+254716000002";

async function login(app: Express, phone: string): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, phone, "passenger", { name: "Booking Passenger" });
  return { token: session.sessionToken, userId: session.user.id };
}

const bookingBody = {
  pickup: { label: "JKIA Terminal 1A", lat: -1.3192, lng: 36.9278 },
  dropoff: { label: "Westlands", lat: -1.2674, lng: 36.807 },
  seats: [3, 4],
};

describe("bookings and prepaid rides", () => {
  const originalDevPay = process.env.ALLOW_DEV_PAYMENT_CONFIRM;

  afterEach(() => {
    if (originalDevPay == null) delete process.env.ALLOW_DEV_PAYMENT_CONFIRM;
    else process.env.ALLOW_DEV_PAYMENT_CONFIRM = originalDevPay;
  });

  it("creates a booking, starts payment, and returns booking status", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);
    process.env.ALLOW_DEV_PAYMENT_CONFIRM = "true";

    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody);
    expect(created.status).toBe(201);
    expect(created.body.booking).toMatchObject({
      id: expect.stringMatching(/^BKG-/),
      passengerId: passenger.userId,
      status: "pending_payment",
      seats: [3, 4],
      platformFee: 50,
      total: expect.any(Number),
      currency: "KES",
    });

    const payment = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/pay`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ provider: "mpesa" });
    expect(payment.status).toBe(200);
    expect(payment.body.payment).toMatchObject({
      provider: "mpesa",
      status: "succeeded",
      checkoutUrl: null,
    });

    const fetched = await request(app)
      .get(`/api/bookings/${created.body.booking.id}`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.booking.id).toBe(created.body.booking.id);
    expect(fetched.body.booking.payment.reference).toBe(payment.body.payment.reference);
  });

  it("disables Flutterwave booking payments until a real checkout exists", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);
    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    const payment = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/pay`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ provider: "flutterwave" });

    expect(payment.status).toBe(503);
    expect(payment.body.error.code).toBe("PAYMENT_PROVIDER_DISABLED");
  });

  it("disables manual M-Pesa Paybill and Till booking payments", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);
    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    const payment = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/pay`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ provider: "mpesa", mpesaChannel: "paybill" });

    expect(payment.status).toBe(503);
    expect(payment.body.error.code).toBe("MPESA_MANUAL_DISABLED");
  });

  it("masks booking existence from other passengers", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);
    const other = await login(app, PASSENGER_2_PHONE);
    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    const hidden = await request(app)
      .get(`/api/bookings/${created.body.booking.id}`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("blocks a new ride request when passenger has an outstanding unpaid booking", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);

    // First, create an unpaid booking (status: pending_payment).
    await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    // Now attempt a NEW, unrelated ride request (cash on arrival, no bookingId).
    const blocked = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
        dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
        prepaid: false,
        paymentMethod: null,
      });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("UNPAID_TRIP_PENDING");
    expect(blocked.body.error.message).toMatch(/pending trip/i);
  });

  it("allows a new ride request once previous bookings are no longer pending payment", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);

    const previous = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    // Resolve the prior booking so the passenger can plan another trip.
    await prisma.booking.update({
      where: { id: previous.body.booking.id },
      data: { status: "paid" },
    });

    const allowed = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
        dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
        prepaid: false,
        paymentMethod: null,
      });
    expect(allowed.status).toBe(201);
  });

  it("cancels a pending_payment booking and releases shared SGR seats", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);
    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    const cancelled = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.booking.status).toBe("cancelled");

    const fetched = await request(app)
      .get(`/api/bookings/${created.body.booking.id}`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(fetched.body.booking.status).toBe("cancelled");
  });

  it("rejects cancelling a paid booking", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);
    process.env.ALLOW_DEV_PAYMENT_CONFIRM = "true";
    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);
    await request(app)
      .post(`/api/bookings/${created.body.booking.id}/pay`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ provider: "mpesa" })
      .expect(200);

    const blocked = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("INVALID_BOOKING_STATUS");
  });

  it("requires a paid booking before prepaid ride request succeeds", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE);
    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    const unpaidRide = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ ...bookingBody, prepaid: true, bookingId: created.body.booking.id, paymentMethod: "card" });
    expect(unpaidRide.status).toBe(409);
    expect(unpaidRide.body.error.code).toBe("BOOKING_NOT_PAID");

    await prisma.booking.update({
      where: { id: created.body.booking.id },
      data: { status: "paid" },
    });

    const paidRide = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ ...bookingBody, prepaid: true, bookingId: created.body.booking.id, paymentMethod: "card" });
    expect(paidRide.status).toBe(201);
    expect(paidRide.body.ride.prepaid).toBe(true);
    expect(paidRide.body.ride.bookingId).toBe(created.body.booking.id);
  });
});
