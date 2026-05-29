import type { Express } from "express";
import type { Server } from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const PASSENGER_PHONE = "+254715000001";
const DRIVER_PHONE = "+254725000001";

let server: Server | null = null;

afterEach(
  () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.closeAllConnections?.();
      server.close(() => {
        server = null;
        resolve();
      });
    }),
);

async function login(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, phone, role, {
    name: role === "driver" ? "Nearby Driver" : "Nearby Passenger",
  });
  return { token: session.sessionToken, userId: session.user.id };
}

async function listen(app: Express): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const address = server?.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP server address.");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function createSseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  return async function next<T>(): Promise<T> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const eventEnd = buffer.indexOf("\n\n");
      if (eventEnd !== -1) {
        const raw = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);
        const data = raw
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .join("");
        if (!data) continue;
        return JSON.parse(data) as T;
      }
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for SSE bytes.")), Math.max(1, deadline - Date.now())),
        ),
      ]);
      if (done) throw new Error("SSE stream ended.");
      buffer += decoder.decode(value, { stream: true });
    }
    throw new Error("Timed out waiting for SSE event.");
  };
}

const locationBody = {
  lat: -1.2674,
  lng: 36.807,
  heading: 140,
  speedKmh: 32,
  accuracyM: 12,
};

const rideBody = {
  pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
  dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
  prepaid: false,
  paymentMethod: null,
};

describe("driver location, nearby, and offers", () => {
  it("accepts driver location even while offline", async () => {
    const app = buildTestApp();
    const driver = await login(app, DRIVER_PHONE, "driver");

    const offline = await request(app)
      .post("/api/drivers/me/location")
      .set("Authorization", `Bearer ${driver.token}`)
      .send(locationBody);
    expect(offline.status).toBe(204);

    await setupDriverForDispatch(app, driver.token, {
      lat: locationBody.lat,
      lng: locationBody.lng,
    });

    await request(app)
      .post("/api/drivers/me/location")
      .set("Authorization", `Bearer ${driver.token}`)
      .send(locationBody)
      .expect(204);
  });

  it("returns nearby online drivers and excludes stale locations", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");

    await setupDriverForDispatch(app, driver.token, {
      lat: locationBody.lat,
      lng: locationBody.lng,
    });

    const nearby = await request(app)
      .get("/api/drivers/nearby")
      .query({ lat: -1.268, lng: 36.806, vehicleType: "All", radiusKm: 5 })
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(nearby.status).toBe(200);
    expect(nearby.body.drivers).toHaveLength(1);
    expect(nearby.body.drivers[0]).toMatchObject({
      driverId: driver.userId,
      name: "Nearby Driver",
      location: expect.objectContaining({ lat: -1.2674, lng: 36.807 }),
      estimatedFare: expect.objectContaining({ amount: expect.any(Number), currency: "KES" }),
    });

    await prisma.driverProfile.update({
      where: { userId: driver.userId },
      data: { locationUpdatedAt: new Date(Date.now() - 2 * 60 * 1000) },
    });

    const stale = await request(app)
      .get("/api/drivers/nearby")
      .query({ lat: -1.268, lng: 36.806, vehicleType: "All", radiusKm: 5 })
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(stale.status).toBe(200);
    expect(stale.body.drivers).toEqual([]);
  });

  it("streams ride.offer to an eligible online driver and streams driver location updates on active rides", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    await setupDriverForDispatch(app, driver.token, {
      lat: locationBody.lat,
      lng: locationBody.lng,
    });

    const baseUrl = await listen(app);
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/rides/active/stream`, {
      headers: { Authorization: `Bearer ${driver.token}` },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    if (!response.body) throw new Error("Expected SSE body.");
    const nextEvent = createSseReader(response.body.getReader());
    await nextEvent<{ type: string; ride: null }>();

    const created = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ ...rideBody, preferredDriverId: driver.userId });
    expect(created.status).toBe(201);
    const offer = await nextEvent<{ type: string; offer: { rideId: string; expiresAt: string } }>();
    expect(offer).toMatchObject({
      type: "ride.offer",
      offer: { rideId: created.body.ride.id, expiresAt: expect.any(String) },
    });

    await request(app)
      .post(`/api/rides/${created.body.ride.id}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);
    await nextEvent();

    await request(app)
      .post("/api/drivers/me/location")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ ...locationBody, lat: -1.27, lng: 36.808 })
      .expect(204);
    const updated = await nextEvent<{ type: string; ride: { id: string; driverLocation: { lat: number; lng: number } } }>();
    expect(updated).toMatchObject({
      type: "ride.updated",
      ride: {
        id: created.body.ride.id,
        driverLocation: { lat: -1.27, lng: 36.808 },
      },
    });

    controller.abort();
  });
});
