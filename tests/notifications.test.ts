import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const PASSENGER_PHONE = "+254718000001";
const DRIVER_PHONE = "+254728000001";

async function login(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, phone, role, {
    name: role === "driver" ? "Notify Driver" : "Notify Passenger",
  });
  return { token: session.sessionToken, userId: session.user.id };
}

describe("notifications and devices", () => {
  it("registers a push token and returns inbox notifications newest first", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");

    const device = await request(app)
      .post("/api/devices")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ pushToken: "ExponentPushToken[test]", platform: "ios" });
    expect(device.status).toBe(200);
    expect(device.body.device).toMatchObject({ pushToken: "ExponentPushToken[test]", platform: "ios" });

    await prisma.notification.createMany({
      data: [
        { id: "notif_old", userId: passenger.userId, title: "Old", body: "Old body", type: "system" },
        { id: "notif_new", userId: passenger.userId, title: "New", body: "New body", type: "system" },
      ],
    });

    const inbox = await request(app)
      .get("/api/notifications")
      .query({ limit: 10 })
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.notifications).toHaveLength(2);
    expect(inbox.body.notifications[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      read: false,
      type: "system",
    });
  });

  it("creates ride offer and accepted notifications", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");

    await setupDriverForDispatch(app, driver.token, { lat: -1.2674, lng: 36.807 });

    const created = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
        dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
        preferredDriverId: driver.userId,
        prepaid: false,
        paymentMethod: null,
      })
      .expect(201);

    const driverInbox = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(driverInbox.body.notifications[0]).toMatchObject({
      type: "ride_offer",
      deepLink: `songa://rides/${created.body.ride.id}`,
    });

    await request(app)
      .post(`/api/rides/${created.body.ride.id}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);

    const passengerInbox = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(passengerInbox.body.notifications[0]).toMatchObject({
      type: "ride_update",
      title: "Driver accepted",
      deepLink: `songa://rides/${created.body.ride.id}`,
    });
  });
});
