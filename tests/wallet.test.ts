import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

const PASSENGER_PHONE = "+254717000001";
const DRIVER_PHONE = "+254727000001";

async function login(
  app: Express,
  phone: string,
  role: "passenger" | "driver",
): Promise<{ token: string; userId: string }> {
  const session = await createAuthSession(app, phone, role, {
    name: role === "driver" ? "Wallet Driver" : "Wallet Passenger",
  });
  return { token: session.sessionToken, userId: session.user.id };
}

async function completeRide(app: Express, passengerToken: string, driverToken: string): Promise<{ rideId: string; price: number }> {
  const created = await request(app)
    .post("/api/rides/request")
    .set("Authorization", `Bearer ${passengerToken}`)
    .send({
      pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
      dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
      prepaid: false,
      paymentMethod: null,
    })
    .expect(201);
  const rideId = created.body.ride.id as string;
  await request(app).post(`/api/rides/${rideId}/accept`).set("Authorization", `Bearer ${driverToken}`).send().expect(200);
  await request(app).post(`/api/rides/${rideId}/arrived`).set("Authorization", `Bearer ${driverToken}`).send().expect(200);
  await request(app).post(`/api/rides/${rideId}/start`).set("Authorization", `Bearer ${driverToken}`).send().expect(200);
  await request(app).post(`/api/rides/${rideId}/complete`).set("Authorization", `Bearer ${driverToken}`).send().expect(200);
  return { rideId, price: created.body.ride.price as number };
}

describe("driver wallet", () => {
  it("credits wallet on trip completion and returns wallet transactions", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    const { rideId, price } = await completeRide(app, passenger.token, driver.token);

    const tx = await prisma.walletTransaction.findFirst({ where: { rideId } });
    expect(tx).toMatchObject({
      driverId: driver.userId,
      type: "credit",
      amount: Math.max(0, price - 50),
      status: "posted",
    });

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance).toBe(Math.max(0, price - 50));
    expect(wallet.body.pendingPayout).toBe(0);
    expect(wallet.body.transactions[0]).toMatchObject({
      id: tx?.id,
      type: "credit",
      amount: Math.max(0, price - 50),
    });
  });

  it("creates pending cashout debits and rejects insufficient funds", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    const { price } = await completeRide(app, passenger.token, driver.token);
    const balance = Math.max(0, price - 50);

    const tooMuch = await request(app)
      .post("/api/drivers/me/wallet/cashout")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ amount: balance + 1, method: "mpesa", phone: "+254727000001" });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("INSUFFICIENT_FUNDS");

    const cashout = await request(app)
      .post("/api/drivers/me/wallet/cashout")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ amount: Math.min(100, balance), method: "mpesa", phone: "+254727000001" });
    expect(cashout.status).toBe(200);
    expect(cashout.body.transaction).toMatchObject({
      type: "debit",
      status: "pending",
      amount: -Math.min(100, balance),
    });

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(wallet.body.pendingPayout).toBe(Math.min(100, balance));
  });
});
