import type { Express } from "express";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import {
  notifyDriverSeatsPaid,
  notifyDriverSeatsReserved,
  notifyDriversPassengerPoolWaiting,
} from "../src/services/shared-rides/shared-rides-notify.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const DRIVER_PHONE = "+254713400201";

async function loginDriver(app: Express, online = true) {
  const session = await createAuthSession(app, DRIVER_PHONE, "driver", { name: "Notify Driver" });
  await setupDriverForDispatch(app, session.sessionToken, { type: "Van", seats: 14 });
  if (online) {
    await prisma.driverProfile.update({
      where: { userId: session.user.id },
      data: { isOnline: true },
    });
  }
  return session;
}

describe("shared-rides driver notifications", () => {
  it("creates pool waiting notifications for online drivers", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app, true);

    await notifyDriversPassengerPoolWaiting({
      tripRequestId: "trip_req_test",
      routeLabel: "Nyali → SGR Miritini",
      departureAtIso: "2026-06-06T04:00:00+03:00",
      poolSeatsTotal: 2,
      direction: "to_sgr",
    });

    const row = await prisma.notification.findFirst({
      where: { userId: driver.user.id, type: "shared_ride_pool_waiting" },
      orderBy: { createdAt: "desc" },
    });
    expect(row).toMatchObject({
      title: "Passengers waiting for a driver",
      deepLink: "songa://driver/shared-rides/join",
    });
  });

  it("creates seat reserved and paid notifications for the departure driver", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app, false);

    await notifyDriverSeatsReserved({
      driverId: driver.user.id,
      departureId: "dep_test",
      routeLabel: "Nyali → SGR Miritini",
      passengerName: "Jane M",
      seatNumbers: [3, 4],
    });

    await notifyDriverSeatsPaid({
      driverId: driver.user.id,
      departureId: "dep_test",
      routeLabel: "Nyali → SGR Miritini",
      passengerName: "Jane M",
      seatNumbers: [3, 4],
      amountKes: 700,
    });

    const reserved = await prisma.notification.findFirst({
      where: { userId: driver.user.id, type: "shared_ride_seat_reserved" },
      orderBy: { createdAt: "desc" },
    });
    const paid = await prisma.notification.findFirst({
      where: { userId: driver.user.id, type: "shared_ride_seat_paid" },
      orderBy: { createdAt: "desc" },
    });

    expect(reserved?.body).toContain("Jane M");
    expect(reserved?.deepLink).toBe("songa://driver/shared-rides/departures/dep_test");
    expect(paid?.body).toContain("KES 700");
  });
});
