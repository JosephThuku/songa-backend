import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { seedSharedRidesCoast } from "../prisma/seeds/shared-rides-coast.js";
import { verifyBookingPayInvite } from "../src/lib/booking-pay-invite.js";
import { _setSmsProvider } from "../src/lib/sms.js";
import { releaseExpiredSeatHolds } from "../src/services/shared-rides/departure-seats.service.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const smsSend = vi.fn(async () => ({ ok: true as const, provider: "console" as const }));

const CALLER_PHONE = "+254713300201";
const DRIVER_PHONE = "+254713300202";
const DEMO_DEPARTURE_ID = "dep_seed_nyali_sgr_morning";

describe("shared rides call-in booking", () => {
  beforeEach(() => {
    smsSend.mockClear();
    _setSmsProvider({ name: "console", send: smsSend });
  });

  afterEach(() => {
    _setSmsProvider(null);
  });

  it("creates passenger, hold, booking, and guest pay invite without login", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const driver = await createAuthSession(app, DRIVER_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 14 });
    await prisma.sharedDeparture.update({
      where: { id: DEMO_DEPARTURE_ID },
      data: { driverId: driver.user.id, status: "scheduled" },
    });

    const callIn = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/call-in-bookings`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({
        phone: CALLER_PHONE,
        passengerName: "Caller",
        seatNumbers: [9],
        pickup: { label: "Beach road", lat: -4.05, lng: 39.72 },
      });
    expect(callIn.status).toBe(201);
    expect(callIn.body.payInviteToken).toBeTruthy();
    expect(callIn.body.payInviteUrl).toContain("token=");

    const payload = verifyBookingPayInvite(callIn.body.payInviteToken);
    expect(payload.bid).toBe(callIn.body.bookingId);

    const summary = await request(app).get(
      `/api/shared-rides/pay-invites/${encodeURIComponent(callIn.body.payInviteToken)}`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body.booking.requiresLogin).toBe(false);
    expect(summary.body.booking.total).toBeGreaterThan(0);

    const user = await prisma.user.findFirst({
      where: { phone: CALLER_PHONE, role: "passenger" },
    });
    expect(user).toBeTruthy();
    expect(user?.passwordHash).toBeNull();

    const payInvite = await request(app)
      .post(
        `/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/seats/9/pay-invite`,
      )
      .set("Authorization", `Bearer ${driver.sessionToken}`);
    expect(payInvite.status).toBe(200);
    expect(payInvite.body.payInviteUrl).toContain("token=");
    expect(payInvite.body.passengerPhone).toBe(CALLER_PHONE);

    const markCash = await request(app)
      .post(
        `/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/seats/9/mark-paid-cash`,
      )
      .set("Authorization", `Bearer ${driver.sessionToken}`);
    expect(markCash.status).toBe(200);

    const seat = await prisma.sharedDepartureSeat.findFirst({
      where: { departureId: DEMO_DEPARTURE_ID, seatNumber: 9 },
    });
    expect(seat?.status).toBe("paid");

    const booking = await prisma.booking.findUnique({
      where: { id: callIn.body.bookingId },
    });
    expect(booking?.status).toBe("paid");
  });

  it("reserves multiple seats for one call-in passenger", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const driver = await createAuthSession(app, DRIVER_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 14 });
    await prisma.sharedDeparture.update({
      where: { id: DEMO_DEPARTURE_ID },
      data: { driverId: driver.user.id, status: "scheduled" },
    });

    const callIn = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/call-in-bookings`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({
        phone: CALLER_PHONE,
        passengerName: "Family Caller",
        seatNumbers: [10, 11],
        pickup: { label: "Beach road", lat: -4.05, lng: 39.72 },
      });
    expect(callIn.status).toBe(201);

    const seats = await prisma.sharedDepartureSeat.findMany({
      where: { departureId: DEMO_DEPARTURE_ID, seatNumber: { in: [10, 11] } },
      orderBy: { seatNumber: "asc" },
    });
    expect(seats.map((s) => s.status)).toEqual(["reserved", "reserved"]);
    expect(seats.every((s) => s.bookingId === callIn.body.bookingId)).toBe(true);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: callIn.body.bookingId },
    });
    expect(booking.seats).toBe("10,11");
    expect(booking.total).toBe(700);
  });

  it("sends SMS with route, total, and seat count for call-in", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const driver = await createAuthSession(app, DRIVER_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 14 });
    await prisma.sharedDeparture.update({
      where: { id: DEMO_DEPARTURE_ID },
      data: { driverId: driver.user.id, status: "scheduled" },
    });

    const callIn = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/call-in-bookings`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({
        phone: CALLER_PHONE,
        passengerName: "Caller",
        seatNumbers: [12, 13],
        pickup: { label: "Beach road", lat: -4.05, lng: 39.72 },
      });
    expect(callIn.status).toBe(201);
    const paySms = smsSend.mock.calls.find((call) =>
      String(call[0]?.body).includes("Pay KSh"),
    );
    expect(paySms).toBeTruthy();
    const smsBody = paySms![0]?.body as string;
    expect(smsBody).toContain("Nyali → SGR Miritini");
    expect(smsBody).toContain("Pay KSh 700");
    expect(smsBody).toMatch(/2 seats/);
    expect(smsBody).toContain(callIn.body.payInviteUrl);
  });

  it("releases expired call-in holds and cancels the pending booking", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);

    const driver = await createAuthSession(app, DRIVER_PHONE, "driver");
    await setupDriverForDispatch(app, driver.sessionToken, { type: "Van", seats: 14 });
    await prisma.sharedDeparture.update({
      where: { id: DEMO_DEPARTURE_ID },
      data: { driverId: driver.user.id, status: "scheduled" },
    });

    const callIn = await request(app)
      .post(`/api/shared-rides/departures/${DEMO_DEPARTURE_ID}/call-in-bookings`)
      .set("Authorization", `Bearer ${driver.sessionToken}`)
      .send({
        phone: "+254713300299",
        seatNumbers: [14],
        pickup: { label: "Beach road", lat: -4.05, lng: 39.72 },
      });
    expect(callIn.status).toBe(201);

    await prisma.sharedDepartureSeat.updateMany({
      where: { departureId: DEMO_DEPARTURE_ID, seatNumber: 14 },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await releaseExpiredSeatHolds(DEMO_DEPARTURE_ID);

    const seat = await prisma.sharedDepartureSeat.findFirst({
      where: { departureId: DEMO_DEPARTURE_ID, seatNumber: 14 },
    });
    expect(seat?.status).toBe("available");
    expect(seat?.bookingId).toBeNull();

    const booking = await prisma.booking.findUnique({
      where: { id: callIn.body.bookingId },
    });
    expect(booking?.status).toBe("cancelled");
  });
});
