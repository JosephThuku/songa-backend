import type { Express } from "express";
import type { Server } from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const PASSENGER_PHONE = "+254714000001";
const DRIVER_PHONE = "+254724000001";

let server: Server | null = null;

afterEach(
  () =>
    new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
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
    name: role === "driver" ? "Stream Driver" : "Stream Passenger",
  });
  return { token: session.sessionToken, userId: session.user.id };
}

function rideBody() {
  return {
    pickup: { label: "JKIA Terminal 1A", lat: -1.3192, lng: 36.9278 },
    dropoff: { label: "Westlands", lat: -1.2674, lng: 36.807 },
    seats: [3, 4],
    prepaid: false,
    paymentMethod: null,
  };
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

function createSseJsonReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  return async function nextSseJson<T>(): Promise<T> {
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

      const remaining = Math.max(1, deadline - Date.now());
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for SSE bytes.")), remaining),
        ),
      ]);
      if (done) throw new Error("SSE stream ended before an event arrived.");
      buffer += decoder.decode(value, { stream: true });
    }
    throw new Error("Timed out waiting for SSE event.");
  };
}

describe("GET /api/rides/active/stream", () => {
  it("requires authentication", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/rides/active/stream");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("streams the active ride snapshot, ride updates, and ride ended event", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    await setupDriverForDispatch(app, driver.token);
    const created = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(rideBody());
    expect(created.status).toBe(201);
    const rideId = created.body.ride.id as string;

    const baseUrl = await listen(app);
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/rides/active/stream`, {
      headers: { Authorization: `Bearer ${passenger.token}` },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    if (!response.body) throw new Error("Expected SSE response body.");
    const reader = response.body.getReader();
    const nextSseJson = createSseJsonReader(reader);

    const initial = await nextSseJson<{ type: string; ride: { id: string; phase: string } | null }>();
    expect(initial).toMatchObject({
      type: "ride.updated",
      ride: { id: rideId, phase: "finding_driver" },
    });

    await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);
    const accepted = await nextSseJson<{ type: string; ride: { id: string; phase: string } }>();
    expect(accepted).toMatchObject({
      type: "ride.updated",
      ride: { id: rideId, phase: "driver_accepted" },
    });

    await request(app)
      .post(`/api/rides/${rideId}/arrived`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);
    await nextSseJson();

    await request(app)
      .post(`/api/rides/${rideId}/start`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);
    const started = await nextSseJson<{ type: string; ride: { id: string; phase: string } }>();
    expect(started).toMatchObject({
      type: "ride.updated",
      ride: { id: rideId, phase: "trip_in_progress" },
    });

    await request(app)
      .post(`/api/rides/${rideId}/complete`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);
    const completed = await nextSseJson<{ type: string; ride: { id: string; phase: string } }>();
    expect(completed).toMatchObject({
      type: "ride.updated",
      ride: { id: rideId, phase: "trip_ended" },
    });
    const ended = await nextSseJson<{ type: string; rideId: string; phase: string }>();
    expect(ended).toEqual({ type: "ride.ended", rideId, phase: "trip_ended" });

    controller.abort();
  });
});
