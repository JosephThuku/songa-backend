import type { Express } from "express";
import cuid from "cuid";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";
import { postDriverWalletCredit } from "../src/services/wallet.service.js";

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
  await setupDriverForDispatch(app, driverToken, { lat: -1.2674, lng: 36.807 });
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

async function seedWalletCredit(driverId: string, amount: number) {
  return prisma.$transaction(async (db) =>
    postDriverWalletCredit(db, {
      driverId,
      type: "shared_booking_credit",
      label: "Shared van test credit",
      amount,
    }),
  );
}

describe("driver wallet", () => {
  const savedInitiator = process.env.MPESA_INITIATOR_NAME;
  const savedInitiatorPw = process.env.MPESA_INITIATOR_PASSWORD;
  const savedSubscription = process.env.DRIVER_DAILY_SUBSCRIPTION_KES;
  const savedSubscriptionByType = process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE;

  beforeEach(() => {
    delete process.env.MPESA_INITIATOR_NAME;
    delete process.env.MPESA_INITIATOR_PASSWORD;
    delete process.env.DRIVER_DAILY_SUBSCRIPTION_KES;
    delete process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE;
  });

  afterEach(() => {
    if (savedInitiator) process.env.MPESA_INITIATOR_NAME = savedInitiator;
    else delete process.env.MPESA_INITIATOR_NAME;
    if (savedInitiatorPw) process.env.MPESA_INITIATOR_PASSWORD = savedInitiatorPw;
    else delete process.env.MPESA_INITIATOR_PASSWORD;
    if (savedSubscription) process.env.DRIVER_DAILY_SUBSCRIPTION_KES = savedSubscription;
    else delete process.env.DRIVER_DAILY_SUBSCRIPTION_KES;
    if (savedSubscriptionByType) process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE = savedSubscriptionByType;
    else delete process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE;
  });

  it("does not create withdrawable wallet balance for pay-on-drop rides", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    const { rideId } = await completeRide(app, passenger.token, driver.token);

    const tx = await prisma.walletTransaction.findFirst({ where: { rideId } });
    expect(tx).toBeNull();

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance).toBe(0);
    expect(wallet.body.pendingPayout).toBe(0);
    expect(wallet.body.transactions).toEqual([]);
  });

  it("calculates wallet balance across all transactions while returning recent transactions", async () => {
    const app = buildTestApp();
    const driver = await login(app, DRIVER_PHONE, "driver");
    process.env.DRIVER_DAILY_SUBSCRIPTION_KES = "0";

    for (let i = 0; i < 31; i += 1) {
      await seedWalletCredit(driver.userId, 10);
    }

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance).toBe(310);
    expect(wallet.body.transactions).toHaveLength(30);
  });

  it("creates pending cashout debits and rejects insufficient funds", async () => {
    const app = buildTestApp();
    const driver = await login(app, DRIVER_PHONE, "driver");
    process.env.DRIVER_DAILY_SUBSCRIPTION_KES = "0";
    const balance = 500;
    await seedWalletCredit(driver.userId, balance);

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

  it("returns earnings breakdown with cash vs M-Pesa totals", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    process.env.DRIVER_DAILY_SUBSCRIPTION_KES = "0";
    const { price: cashPrice } = await completeRide(app, passenger.token, driver.token);
    await seedWalletCredit(driver.userId, 800);

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.totalCash).toBe(cashPrice);
    expect(wallet.body.totalMpesa).toBe(800);
    expect(wallet.body.totalEarnings).toBe(cashPrice + 800);
    expect(wallet.body.withdrawable).toBe(wallet.body.maxCashoutAmount);
  });

  it("shows subscription owed for cash-only drivers with no wallet balance", async () => {
    const app = buildTestApp();
    const passenger = await login(app, PASSENGER_PHONE, "passenger");
    const driver = await login(app, DRIVER_PHONE, "driver");
    process.env.DRIVER_DAILY_SUBSCRIPTION_KES = "150";
    await completeRide(app, passenger.token, driver.token);

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance).toBe(0);
    expect(wallet.body.subscriptionOwed).toBe(150);
    expect(wallet.body.subscriptionDue).toBe(150);
  });

  it("deducts subscription on first wallet credit of the day", async () => {
    const app = buildTestApp();
    const driver = await login(app, DRIVER_PHONE, "driver");
    process.env.DRIVER_DAILY_SUBSCRIPTION_KES = "150";
    await seedWalletCredit(driver.userId, 700);

    const fee = await prisma.walletTransaction.findFirst({
      where: { driverId: driver.userId, type: "subscription_fee" },
    });
    expect(fee).toMatchObject({ amount: -150, status: "posted" });

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(wallet.body.balance).toBe(550);
    expect(wallet.body.subscriptionDue).toBe(0);
    expect(wallet.body.subscriptionOwed).toBe(0);
  });

  it("uses vehicle-type subscription amount when configured", async () => {
    const app = buildTestApp();
    const driver = await login(app, DRIVER_PHONE, "driver");
    process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE = JSON.stringify({ Car: 200 });
    await setupDriverForDispatch(app, driver.token, { lat: -1.2674, lng: 36.807 });

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.subscriptionDue).toBe(200);
  });

  it("deducts today's subscription before allowing cashout", async () => {
    const app = buildTestApp();
    const driver = await login(app, DRIVER_PHONE, "driver");
    process.env.DRIVER_DAILY_SUBSCRIPTION_KES = "150";
    await seedWalletCredit(driver.userId, 700);

    const tooMuch = await request(app)
      .post("/api/drivers/me/wallet/cashout")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ amount: 700, method: "mpesa", phone: "+254727000001" });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("INSUFFICIENT_FUNDS");
    expect(tooMuch.body.error.details.maxCashoutAmount).toBe(550);

    const fee = await prisma.walletTransaction.findFirst({
      where: { driverId: driver.userId, type: "subscription_fee" },
    });
    expect(fee).toMatchObject({
      amount: -150,
      status: "posted",
    });

    const cashout = await request(app)
      .post("/api/drivers/me/wallet/cashout")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ amount: 550, method: "mpesa", phone: "+254727000001" });
    expect(cashout.status).toBe(200);
    expect(cashout.body.transaction).toMatchObject({
      type: "debit",
      amount: -550,
      status: "pending",
    });

    const fees = await prisma.walletTransaction.findMany({
      where: { driverId: driver.userId, type: "subscription_fee" },
    });
    expect(fees).toHaveLength(1);
  });
});
