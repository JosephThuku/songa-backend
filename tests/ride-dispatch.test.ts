// Integration tests for ride dispatch: vehicle-type filtering, declinedBy enforcement.

import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

// Unique phones — no overlap with other test files.
const PASSENGER_PHONE = "+254720000001";
const DRIVER_CAR_PHONE = "+254730000001";
const DRIVER_VAN_PHONE = "+254730000002";
const DRIVER_CAR2_PHONE = "+254730000003";

async function login(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
  name?: string,
): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, phone, role, {
    name: name ?? (role === "driver" ? "Dispatch Driver" : "Dispatch Passenger"),
  });
  return { token: session.sessionToken, userId: session.user.id };
}

/** Register vehicle, go online, post location for a driver. */
async function setupOnlineDriver(
  app: Express,
  token: string,
  opts: {
    vehicleType: string;
    registration: string;
    lat: number;
    lng: number;
    seats?: number;
  },
) {
  await request(app)
    .post("/api/drivers/me/vehicle")
    .set("Authorization", `Bearer ${token}`)
    .send({
      type: opts.vehicleType,
      make: "Toyota",
      model: opts.vehicleType === "Van" ? "HiAce" : "Axio",
      registration: opts.registration,
      color: "White",
      seats: opts.seats ?? (opts.vehicleType === "Van" ? 7 : 4),
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
    .send({ lat: opts.lat, lng: opts.lng })
    .expect(204);
}

function rideBody(overrides: Record<string, unknown> = {}) {
  return {
    pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
    dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
    prepaid: false,
    paymentMethod: null,
    ...overrides,
  };
}

describe("Ride dispatch — vehicle type and declined-by filtering", () => {
  it("driver with wrong vehicle type cannot accept a ride (INVALID_VEHICLE_TYPE)", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const carDriver = await login(app, DRIVER_CAR_PHONE, "driver", "Car Driver");

    await setupOnlineDriver(app, carDriver.token, {
      vehicleType: "Car",
      registration: "KCA001A",
      lat: -1.268,
      lng: 36.808,
    });

    // Request a Van ride; the Car driver tries to accept it.
    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(rideBody({ optionId: "van" }));
    expect(rideRes.status).toBe(201);
    const rideId: string = rideRes.body.ride.id;

    // Ride vehicleType must be Van.
    expect(rideRes.body.ride.vehicleType).toBe("Van");

    const accept = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${carDriver.token}`)
      .send();
    expect(accept.status).toBe(409);
    expect(accept.body.error.code).toBe("INVALID_VEHICLE_TYPE");
  });

  it("Van driver can accept a van ride while Car driver is rejected", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const carDriver = await login(app, DRIVER_CAR_PHONE, "driver", "Car Driver");
    const vanDriver = await login(app, DRIVER_VAN_PHONE, "driver", "Van Driver");

    await setupOnlineDriver(app, carDriver.token, {
      vehicleType: "Car",
      registration: "KCA002A",
      lat: -1.268,
      lng: 36.808,
    });
    await setupOnlineDriver(app, vanDriver.token, {
      vehicleType: "Van",
      registration: "KVA001A",
      lat: -1.268,
      lng: 36.809,
    });

    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(rideBody({ optionId: "van" }));
    expect(rideRes.status).toBe(201);
    const rideId: string = rideRes.body.ride.id;

    // Car driver rejected.
    const carAccept = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${carDriver.token}`)
      .send();
    expect(carAccept.status).toBe(409);
    expect(carAccept.body.error.code).toBe("INVALID_VEHICLE_TYPE");

    // Van driver accepted.
    const vanAccept = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${vanDriver.token}`)
      .send();
    expect(vanAccept.status).toBe(200);
    expect(vanAccept.body.ride.phase).toBe("driver_accepted");
    expect(vanAccept.body.ride.driverId).toBe(vanDriver.userId);
  });

  it("optionId car sets vehicleType=Car on the ride", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");

    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(rideBody({ optionId: "car" }));
    expect(rideRes.status).toBe(201);
    expect(rideRes.body.ride.vehicleType).toBe("Car");
  });

  it("declined driver cannot accept the same ride (declinedBy enforced)", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver1 = await login(app, DRIVER_CAR_PHONE, "driver", "Decliner");
    const driver2 = await login(app, DRIVER_CAR2_PHONE, "driver", "Accepter");

    await setupOnlineDriver(app, driver1.token, {
      vehicleType: "Car",
      registration: "KCA003A",
      lat: -1.268,
      lng: 36.808,
    });
    await setupOnlineDriver(app, driver2.token, {
      vehicleType: "Car",
      registration: "KCA004A",
      lat: -1.267,
      lng: 36.807,
    });

    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(rideBody());
    expect(rideRes.status).toBe(201);
    const rideId: string = rideRes.body.ride.id;

    // driver1 declines.
    const decline = await request(app)
      .post(`/api/rides/${rideId}/decline`)
      .set("Authorization", `Bearer ${driver1.token}`)
      .send();
    expect(decline.status).toBe(200);
    expect(decline.body).toEqual({ ok: true });

    // Verify declinedBy is recorded in DB.
    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.declinedBy).toContain(driver1.userId);

    // driver1 tries to accept → OFFER_DECLINED.
    const declinedAccept = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver1.token}`)
      .send();
    expect(declinedAccept.status).toBe(409);
    expect(declinedAccept.body.error.code).toBe("OFFER_DECLINED");

    // driver2 (not declined) can accept.
    const validAccept = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set("Authorization", `Bearer ${driver2.token}`)
      .send();
    expect(validAccept.status).toBe(200);
    expect(validAccept.body.ride.driverId).toBe(driver2.userId);
  });

  it("default ride (no optionId) sets vehicleType=Car and a Car driver can accept", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const carDriver = await login(app, DRIVER_CAR_PHONE, "driver", "Car Driver");

    await setupOnlineDriver(app, carDriver.token, {
      vehicleType: "Car",
      registration: "KCA005A",
      lat: -1.268,
      lng: 36.808,
    });

    const rideRes = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(rideBody());
    expect(rideRes.status).toBe(201);
    expect(rideRes.body.ride.vehicleType).toBe("Car");

    const accept = await request(app)
      .post(`/api/rides/${rideRes.body.ride.id}/accept`)
      .set("Authorization", `Bearer ${carDriver.token}`)
      .send();
    expect(accept.status).toBe(200);
    expect(accept.body.ride.phase).toBe("driver_accepted");
  });
});
