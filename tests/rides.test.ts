import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

const PASSENGER_PHONE = "+254713000001";
const PASSENGER_2_PHONE = "+254713000002";
const PASSENGER_3_PHONE = "+254713000003";
const DRIVER_PHONE = "+254723000001";
const DRIVER_2_PHONE = "+254723000002";

async function login(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, phone, role, {
    name: role === "driver" ? "Driver Test" : "Passenger Test",
  });
  return { token: session.sessionToken, userId: session.user.id };
}

function rideRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    pickup: { label: "JKIA Terminal 1A", lat: -1.3192, lng: 36.9278 },
    dropoff: { label: "Westlands", lat: -1.2674, lng: 36.807 },
    seats: [3, 4],
    prepaid: false,
    paymentMethod: null,
    ...overrides,
  };
}

async function requestRide(app: Express, token: string, body = rideRequestBody()) {
  return request(app)
    .post("/api/rides/request")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

async function createRide(app: Express, passengerToken: string): Promise<string> {
  const res = await requestRide(app, passengerToken);
  expect(res.status).toBe(201);
  return res.body.ride.id as string;
}

describe("Stage 2 ride lifecycle", () => {
  it("lets a passenger request a terminal ride and logs ride.requested", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");

    const res = await requestRide(app, passenger.token);

    expect(res.status).toBe(201);
    expect(res.body.ride).toMatchObject({
      id: expect.stringMatching(/^ride_/),
      passengerId: passenger.userId,
      driverId: null,
      phase: "finding_driver",
      bookingMode: "seat_selection",
      prepaid: false,
      currency: "KES",
      seats: [3, 4],
      pickup: expect.objectContaining({ label: "JKIA Terminal 1A" }),
      dropoff: expect.objectContaining({ label: "Westlands" }),
      passenger: expect.objectContaining({ id: passenger.userId, name: "Passenger Test" }),
      driver: null,
      vehicle: null,
    });

    const events = await prisma.rideEvent.findMany({ where: { rideId: res.body.ride.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor: "passenger",
      actorId: passenger.userId,
      action: "ride.requested",
      phase: "finding_driver",
    });
  });

  it("drives the happy path from accept through complete with events in order", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    const rideId = await createRide(app, passenger.token);

    const accepted = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(accepted.status).toBe(200);
    expect(accepted.body.ride.phase).toBe("driver_accepted");
    expect(accepted.body.ride.driverId).toBe(driver.userId);

    const arrived = await request(app)
      .post(`/api/rides/${rideId}/arrived`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(arrived.status).toBe(200);
    expect(arrived.body.ride.phase).toBe("driver_arrived");

    const started = await request(app)
      .post(`/api/rides/${rideId}/start`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(started.status).toBe(200);
    expect(started.body.ride.phase).toBe("trip_in_progress");
    expect(started.body.ride.passengerBoarded).toBe(true);

    const completed = await request(app)
      .post(`/api/rides/${rideId}/complete`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(completed.status).toBe(200);
    expect(completed.body.ride.phase).toBe("trip_ended");
    expect(completed.body.ride.driverProgress).toBe(1);

    const events = await prisma.rideEvent.findMany({ where: { rideId }, orderBy: { at: "asc" } });
    expect(events.map((event) => event.action)).toEqual([
      "ride.requested",
      "driver.accepted",
      "driver.arrived",
      "trip.started",
      "trip.ended",
    ]);
  });

  it("rejects invalid phase transitions with the planned error codes", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    const rideId = await createRide(app, passenger.token);

    const startEarly = await request(app)
      .post(`/api/rides/${rideId}/start`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(startEarly.status).toBe(404);
    expect(startEarly.body.error.code).toBe("RIDE_NOT_FOUND");

    await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);

    const acceptAgain = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(acceptAgain.status).toBe(409);
    expect(acceptAgain.body.error.code).toBe("OFFER_EXPIRED");

    const completeEarly = await request(app)
      .post(`/api/rides/${rideId}/complete`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(completeEarly.status).toBe(409);
    expect(completeEarly.body.error.code).toBe("INVALID_PHASE");
  });

  it("validates booking mode and cancel reasons", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");

    const missingSeats = await requestRide(
      app,
      passenger.token,
      rideRequestBody({ seats: undefined }),
    );
    expect(missingSeats.status).toBe(409);
    expect(missingSeats.body.error.code).toBe("SEATS_REQUIRED");

    const nonTerminal = await requestRide(
      app,
      passenger.token,
      rideRequestBody({
        pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
        dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
        seats: undefined,
      }),
    );
    expect(nonTerminal.status).toBe(201);
    expect(nonTerminal.body.ride.bookingMode).toBe("pay_on_arrival");

    const invalidSeatsPassenger = await login(app, PASSENGER_3_PHONE, "passenger");
    const seatsOnNonTerminal = await requestRide(
      app,
      invalidSeatsPassenger.token,
      rideRequestBody({
        pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
        dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
        seats: [1],
      }),
    );
    expect(seatsOnNonTerminal.status).toBe(400);
    expect(seatsOnNonTerminal.body.error.code).toBe("INVALID_INPUT");

    const otherWithoutDetail = await request(app)
      .post(`/api/rides/${nonTerminal.body.ride.id}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reasonId: "other", reasonLabel: "Other", detail: "ok" });
    expect(otherWithoutDetail.status).toBe(400);
    expect(otherWithoutDetail.body.error.code).toBe("INVALID_INPUT");

    const cancel = await request(app)
      .post(`/api/rides/${nonTerminal.body.ride.id}/cancel`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ reasonId: "other", reasonLabel: "Other", detail: "Need a safer pickup" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.ride.phase).toBe("cancelled");
    expect(cancel.body.ride.cancelReason).toEqual({
      reasonId: "other",
      reasonLabel: "Other",
      detail: "Need a safer pickup",
    });

    const sgrPassenger = await login(app, PASSENGER_2_PHONE, "passenger");
    const sgr = await requestRide(
      app,
      sgrPassenger.token,
      rideRequestBody({
        pickup: { label: "SGR terminus", lat: -1.361, lng: 36.958 },
        dropoff: { label: "Karen", lat: -1.319, lng: 36.706 },
      }),
    );
    expect(sgr.status).toBe(201);
    expect(sgr.body.ride.bookingMode).toBe("seat_selection");
  });

  it("enforces authorization, active ride, decline, and idempotency rules", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const passenger2 = await login(app, PASSENGER_2_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    const driver2 = await login(app, DRIVER_2_PHONE, "driver");

    const first = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .set("Idempotency-Key", "ride-key-1")
      .send(rideRequestBody());
    expect(first.status).toBe(201);

    const replay = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .set("Idempotency-Key", "ride-key-1")
      .send(rideRequestBody());
    expect(replay.status).toBe(201);
    expect(replay.body.ride.id).toBe(first.body.ride.id);
    await expect(prisma.ride.count()).resolves.toBe(1);

    const secondKey = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .set("Idempotency-Key", "ride-key-2")
      .send(rideRequestBody());
    expect(secondKey.status).toBe(409);
    expect(secondKey.body.error.code).toBe("RIDE_ALREADY_ACTIVE");

    const otherPassengerCancel = await request(app)
      .post(`/api/rides/${first.body.ride.id}/cancel`)
      .set("Authorization", `Bearer ${passenger2.token}`)
      .send({ reasonId: "plans_changed", reasonLabel: "Plans changed", detail: null });
    expect(otherPassengerCancel.status).toBe(404);
    expect(otherPassengerCancel.body.error.code).toBe("RIDE_NOT_FOUND");

    const randomGet = await request(app)
      .get(`/api/rides/${first.body.ride.id}`)
      .set("Authorization", `Bearer ${passenger2.token}`);
    expect(randomGet.status).toBe(404);
    expect(randomGet.body.error.code).toBe("RIDE_NOT_FOUND");

    const declinedRideId = await createRide(app, passenger2.token);
    const decline = await request(app)
      .post(`/api/rides/${declinedRideId}/decline`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(decline.status).toBe(200);
    expect(decline.body).toEqual({ ok: true });

    const declinedAccept = await request(app)
      .post(`/api/rides/${declinedRideId}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send();
    expect(declinedAccept.status).toBe(409);
    expect(declinedAccept.body.error.code).toBe("OFFER_DECLINED");

    const accepted = await request(app)
      .post(`/api/rides/${declinedRideId}/accept`)
      .set("Authorization", `Bearer ${driver2.token}`)
      .set("Idempotency-Key", "accept-key-1")
      .send();
    expect(accepted.status).toBe(200);

    const acceptReplay = await request(app)
      .post(`/api/rides/${declinedRideId}/accept`)
      .set("Authorization", `Bearer ${driver2.token}`)
      .set("Idempotency-Key", "accept-key-1")
      .send();
    expect(acceptReplay.status).toBe(200);
    expect(acceptReplay.body.ride.id).toBe(declinedRideId);
  });

  it("returns active rides and lets an approved driver toggle online status", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    const rideId = await createRide(app, passenger.token);

    const passengerActive = await request(app)
      .get("/api/rides/active")
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(passengerActive.status).toBe(200);
    expect(passengerActive.body.ride.id).toBe(rideId);

    const online = await request(app)
      .patch("/api/drivers/me/online")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ isOnline: true });
    expect(online.status).toBe(200);
    expect(online.body.isOnline).toBe(true);
    expect(online.body.onlineSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const offline = await request(app)
      .patch("/api/drivers/me/online")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ isOnline: false });
    expect(offline.status).toBe(200);
    expect(offline.body).toEqual({ isOnline: false, onlineSince: null });

    const passengerOnline = await request(app)
      .patch("/api/drivers/me/online")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ isOnline: true });
    expect(passengerOnline.status).toBe(403);
    expect(passengerOnline.body.error.code).toBe("DRIVER_NOT_APPROVED");
  });
});
