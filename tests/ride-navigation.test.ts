import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

const PASSENGER_PHONE = "+254716000001";
const DRIVER_PHONE = "+254726000001";

describe("ride navigation", () => {
  it("does not fabricate a pickup route when the driver has not streamed live GPS", async () => {
    const app = buildTestApp();
    const passenger = await createAuthSession(app, PASSENGER_PHONE, "passenger", {
      name: "Navigation Passenger",
    });
    const driver = await createAuthSession(app, DRIVER_PHONE, "driver", {
      name: "Navigation Driver",
    });

    const ride = await prisma.ride.create({
      data: {
        id: "ride_navigation_no_gps",
        passengerId: passenger.user.id,
        driverId: driver.user.id,
        phase: "driver_en_route",
        bookingMode: "pay_on_arrival",
        prepaid: false,
        price: 500,
        pickup: { label: "Nyali Beach", lat: -4.0205, lng: 39.7209 },
        dropoff: { label: "Moi International Airport", lat: -4.0348, lng: 39.5942 },
      },
    });

    const response = await request(app)
      .get(`/api/rides/${ride.id}/navigation`)
      .set("Authorization", `Bearer ${passenger.sessionToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("LOCATION_UNAVAILABLE");
  });
});
