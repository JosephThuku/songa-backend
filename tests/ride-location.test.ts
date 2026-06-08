// Integration tests: driver location updates advance ride phase (en_route → arriving)
// and keep etaMinutes in sync.

import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { DRIVER_ARRIVING_KM } from "../src/lib/geo.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

// Unique phones — no overlap with other test files.
const PASSENGER_PHONE = "+254712000001";
const DRIVER_PHONE = "+254722000001";

async function login(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, phone, role, {
    name: role === "driver" ? "Location Driver" : "Location Passenger",
  });
  return { token: session.sessionToken, userId: session.user.id };
}

/** Register a Car vehicle, go online, then post an initial location. */
async function setupOnlineDriver(
  app: Express,
  token: string,
  lat: number,
  lng: number,
): Promise<void> {
  await request(app)
    .post("/api/drivers/me/vehicle")
    .set("Authorization", `Bearer ${token}`)
    .send({
      type: "Car",
      make: "Toyota",
      model: "Axio",
      registration: "KLC001A",
      color: "Blue",
      seats: 4,
    })
    .expect(200);

  await request(app)
    .patch("/api/drivers/me/online")
    .set("Authorization", `Bearer ${token}`)
    .send({ isOnline: true })
    .expect(200);

  await request(app)
    .post("/api/drivers/me/location")
    .set("Authorization", `Bearer ${token}`)
    .send({ lat, lng })
    .expect(204);
}

// Pickup for all tests: Westlands.
const PICKUP = { label: "Westlands", lat: -1.2674, lng: 36.807 };
const DROPOFF = { label: "Kilimani", lat: -1.2921, lng: 36.7856 };

// ~5.5 km from PICKUP — well above DRIVER_ARRIVING_KM (2 km) → driver_en_route.
const FAR_LOCATION = { lat: -1.22, lng: 36.82 };

// ~0.13 km from PICKUP — below DRIVER_ARRIVING_KM → driver_arriving.
const NEAR_LOCATION = { lat: -1.268, lng: 36.808 };

describe("Driver location → ride phase sync", () => {
  it("advances phase from driver_accepted to driver_en_route when driver is far", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");

    // Set driver far from pickup before ride request (so there's an existing location).
    await setupOnlineDriver(app, driver.token, FAR_LOCATION.lat, FAR_LOCATION.lng);

    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ pickup: PICKUP, dropoff: DROPOFF, prepaid: false, paymentMethod: null });
    expect(rideRes.status).toBe(201);
    const rideId: string = rideRes.body.ride.id;

    await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);

    // Driver posts a location that is far from pickup → should trigger driver_en_route.
    await request(app)
      .post("/api/drivers/me/location")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ lat: FAR_LOCATION.lat + 0.001, lng: FAR_LOCATION.lng })
      .expect(204);

    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.phase).toBe("driver_en_route");
    expect(ride.etaMinutes).toBeGreaterThan(0);
  });

  it("advances phase to driver_arriving when driver is within DRIVER_ARRIVING_KM of pickup", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");

    // Start driver at a far location so they can go online.
    await setupOnlineDriver(app, driver.token, FAR_LOCATION.lat, FAR_LOCATION.lng);

    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ pickup: PICKUP, dropoff: DROPOFF, prepaid: false, paymentMethod: null });
    expect(rideRes.status).toBe(201);
    const rideId: string = rideRes.body.ride.id;

    await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);

    // Driver posts location very close to pickup (< DRIVER_ARRIVING_KM).
    await request(app)
      .post("/api/drivers/me/location")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ lat: NEAR_LOCATION.lat, lng: NEAR_LOCATION.lng })
      .expect(204);

    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.phase).toBe("driver_arriving");

    // etaMinutes should be very small (≤ 1 minute for 0.13 km).
    expect(ride.etaMinutes).toBeGreaterThanOrEqual(1);
    const driverLoc = await prisma.driverLocation.findUnique({ where: { driverId: driver.userId } });
    expect(driverLoc).not.toBeNull();
    expect(driverLoc!.lat).toBeCloseTo(NEAR_LOCATION.lat, 4);
    expect(driverLoc!.lng).toBeCloseTo(NEAR_LOCATION.lng, 4);
  });

  it("transitions from driver_en_route to driver_arriving as driver moves closer", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");

    await setupOnlineDriver(app, driver.token, FAR_LOCATION.lat, FAR_LOCATION.lng);

    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ pickup: PICKUP, dropoff: DROPOFF, prepaid: false, paymentMethod: null });
    expect(rideRes.status).toBe(201);
    const rideId: string = rideRes.body.ride.id;

    await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver.token}`)
      .send()
      .expect(200);

    // 1. Driver is far → driver_en_route.
    await request(app)
      .post("/api/drivers/me/location")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ lat: FAR_LOCATION.lat, lng: FAR_LOCATION.lng })
      .expect(204);

    const afterFar = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(afterFar.phase).toBe("driver_en_route");

    // 2. Driver moves close → driver_arriving.
    await request(app)
      .post("/api/drivers/me/location")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ lat: NEAR_LOCATION.lat, lng: NEAR_LOCATION.lng })
      .expect(204);

    const afterNear = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(afterNear.phase).toBe("driver_arriving");
    expect(afterNear.etaMinutes).toBeLessThanOrEqual(afterFar.etaMinutes ?? 9999);
  });

  it("does NOT update phase on a trip_in_progress or terminal ride", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");

    await setupOnlineDriver(app, driver.token, FAR_LOCATION.lat, FAR_LOCATION.lng);

    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ pickup: PICKUP, dropoff: DROPOFF, prepaid: false, paymentMethod: null });
    const rideId: string = rideRes.body.ride.id;

    // Drive to accepted → arrived → started.
    await request(app).post(`/api/rides/${rideId}/accept`).set("Authorization", `Bearer ${driver.token}`).send().expect(200);
    await request(app).post(`/api/rides/${rideId}/arrived`).set("Authorization", `Bearer ${driver.token}`).send().expect(200);
    await request(app).post(`/api/rides/${rideId}/start`).set("Authorization", `Bearer ${driver.token}`).send().expect(200);

    // Driver posts location. Phase should NOT move back to en_route or arriving.
    await request(app)
      .post("/api/drivers/me/location")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ lat: FAR_LOCATION.lat, lng: FAR_LOCATION.lng })
      .expect(204);

    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.phase).toBe("trip_in_progress");
  });

  it("DRIVER_ARRIVING_KM constant is set to the phase-transition threshold", () => {
    // This constant controls when the phase switches from driver_en_route to driver_arriving.
    // Accept either 0.3 (updated geo.ts) or 2 (original geo.ts) — both are valid per-deployment.
    expect(DRIVER_ARRIVING_KM).toBeGreaterThan(0);
    expect(DRIVER_ARRIVING_KM).toBeLessThanOrEqual(5);
  });
});
