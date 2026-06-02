import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { seedSharedRidesCoast } from "../prisma/seeds/shared-rides-coast.js";
import { verifyBookingPayInvite } from "../src/lib/booking-pay-invite.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const CALLER_PHONE = "+254713300201";
const DRIVER_PHONE = "+254713300202";
const DEMO_DEPARTURE_ID = "dep_seed_nyali_sgr_morning";

describe("shared rides call-in booking", () => {
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
        seatNumbers: [6],
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
  });
});
