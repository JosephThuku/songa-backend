import cuid from "cuid";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/lib/openapi.js";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession, loginAsAdmin } from "./helpers.js";

function adminAuth(sessionToken: string) {
  return { Authorization: `Bearer ${sessionToken}` };
}

async function seedOpsData(app: Express) {
  const passenger = await createAuthSession(app, "+254790100001", "passenger", {
    name: "Admin Passenger",
  });
  const driver = await createAuthSession(app, "+254790100002", "driver", {
    name: "Admin Driver",
  });

  const booking = await prisma.booking.create({
    data: {
      id: `BKG-${cuid()}`,
      passengerId: passenger.user.id,
      status: "pending_payment",
      subtotal: 500,
      platformFee: 0,
      total: 500,
      pickup: { label: "Nyali", lat: -4.04, lng: 39.71 },
      dropoff: { label: "SGR Miritini", lat: -4.02, lng: 39.59 },
    },
  });
  await prisma.payment.create({
    data: {
      id: `pay_${cuid()}`,
      bookingId: booking.id,
      provider: "mpesa",
      reference: `adm_${cuid()}`,
      status: "pending",
    },
  });

  const ride = await prisma.ride.create({
    data: {
      id: `ride_${cuid()}`,
      passengerId: passenger.user.id,
      driverId: driver.user.id,
      phase: "trip_ended",
      bookingMode: "pay_on_arrival",
      price: 450,
      pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
      dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
    },
  });

  const walletTx = await prisma.walletTransaction.create({
    data: {
      id: `tx_${cuid()}`,
      driverId: driver.user.id,
      rideId: ride.id,
      type: "debit",
      label: "Cashout · mpesa",
      amount: -100,
      status: "pending",
      metadata: { method: "mpesa", phone: "+254790100002" },
    },
  });

  return { passenger, driver, booking, ride, walletTx };
}

describe("Admin ops API", () => {
  it("registers admin ops OpenAPI paths", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/api/admin/users"]).toBeDefined();
    expect(doc.paths?.["/api/admin/drivers"]).toBeDefined();
    expect(doc.paths?.["/api/admin/bookings"]).toBeDefined();
    expect(doc.paths?.["/api/admin/rides"]).toBeDefined();
    expect(doc.paths?.["/api/admin/wallet-transactions"]).toBeDefined();
    expect(doc.paths?.["/api/admin/cashouts"]).toBeDefined();
  });

  it("requires an admin session", async () => {
    const app = buildTestApp();

    await request(app).get("/api/admin/users").expect(401);

    const passenger = await createAuthSession(app, "+254790199001", "passenger");
    const forbidden = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${passenger.sessionToken}`);
    expect(forbidden.status).toBe(403);
  });

  it("lists users, drivers, bookings, rides, wallet transactions, and cashouts", async () => {
    const app = buildTestApp();
    const seed = await seedOpsData(app);
    const admin = await loginAsAdmin(app);
    const auth = adminAuth(admin.sessionToken);

    const users = await request(app).get("/api/admin/users?role=passenger").set(auth);
    expect(users.status).toBe(200);
    expect(users.body.users.some((u: { id: string }) => u.id === seed.passenger.user.id)).toBe(true);
    expect(users.body.users[0].passwordHash).toBeUndefined();

    const userDetail = await request(app).get(`/api/admin/users/${seed.passenger.user.id}`).set(auth);
    expect(userDetail.status).toBe(200);
    expect(userDetail.body.user._count.bookings).toBeGreaterThanOrEqual(1);

    const drivers = await request(app).get("/api/admin/drivers?onboardingStatus=approved").set(auth);
    expect(drivers.status).toBe(200);
    expect(drivers.body.drivers.some((d: { id: string }) => d.id === seed.driver.user.id)).toBe(true);

    const driverDetail = await request(app).get(`/api/admin/drivers/${seed.driver.user.id}`).set(auth);
    expect(driverDetail.status).toBe(200);
    expect(driverDetail.body.driver.driverProfile.onboardingStatus).toBe("approved");

    const bookings = await request(app).get("/api/admin/bookings?status=pending_payment").set(auth);
    expect(bookings.status).toBe(200);
    expect(bookings.body.bookings.some((b: { id: string }) => b.id === seed.booking.id)).toBe(true);
    expect(bookings.body.bookings[0].payments).toBeDefined();

    const bookingDetail = await request(app).get(`/api/admin/bookings/${seed.booking.id}`).set(auth);
    expect(bookingDetail.status).toBe(200);
    expect(bookingDetail.body.booking.passenger.id).toBe(seed.passenger.user.id);

    const rides = await request(app).get("/api/admin/rides?phase=trip_ended").set(auth);
    expect(rides.status).toBe(200);
    expect(rides.body.rides.some((r: { id: string }) => r.id === seed.ride.id)).toBe(true);

    const rideDetail = await request(app).get(`/api/admin/rides/${seed.ride.id}`).set(auth);
    expect(rideDetail.status).toBe(200);
    expect(rideDetail.body.ride.driver.id).toBe(seed.driver.user.id);

    const wallet = await request(app)
      .get(`/api/admin/wallet-transactions?driverId=${seed.driver.user.id}`)
      .set(auth);
    expect(wallet.status).toBe(200);
    expect(wallet.body.transactions.some((tx: { id: string }) => tx.id === seed.walletTx.id)).toBe(true);

    const cashouts = await request(app).get("/api/admin/cashouts?status=pending").set(auth);
    expect(cashouts.status).toBe(200);
    expect(cashouts.body.transactions.some((tx: { id: string }) => tx.id === seed.walletTx.id)).toBe(true);
  });

  it("updates driver onboarding status", async () => {
    const app = buildTestApp();
    const seed = await seedOpsData(app);
    const admin = await loginAsAdmin(app);

    const updated = await request(app)
      .patch(`/api/admin/drivers/${seed.driver.user.id}/status`)
      .set(adminAuth(admin.sessionToken))
      .send({ onboardingStatus: "rejected" });
    expect(updated.status).toBe(200);
    expect(updated.body.driverProfile.onboardingStatus).toBe("rejected");
    expect(updated.body.driverProfile.isOnline).toBe(false);
  });
});
