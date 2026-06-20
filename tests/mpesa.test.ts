import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signBookingPayInvite } from "../src/lib/booking-pay-invite.js";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession, setupDriverForDispatch } from "./helpers.js";

const PASSENGER_PHONE = "+254716000099";
const DRIVER_PHONE = "+254716000088";

const bookingBody = {
  pickup: { label: "JKIA Terminal 1A", lat: -1.3192, lng: 36.9278 },
  dropoff: { label: "Westlands", lat: -1.2674, lng: 36.807 },
  seats: [1],
};

async function loginPassenger(app: Express) {
  const session = await createAuthSession(app, PASSENGER_PHONE, "passenger", { name: "Mpesa Passenger" });
  return { token: session.sessionToken, userId: session.user.id };
}

async function loginDriver(app: Express) {
  const session = await createAuthSession(app, DRIVER_PHONE, "driver", { name: "Mpesa Driver" });
  return { token: session.sessionToken, userId: session.user.id };
}

function mockFetchResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function stubMpesaFetch(stkCheckoutId = "ws_CO_TEST123", b2cOriginatorId = "origin-123") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth/")) {
        return mockFetchResponse({ access_token: "tok" });
      }
      if (url.includes("/stkpush/v1/processrequest")) {
        return mockFetchResponse({
          ResponseCode: "0",
          CheckoutRequestID: stkCheckoutId,
          CustomerMessage: "Success. Request accepted for processing",
        });
      }
      if (url.includes("/stkpushquery/")) {
        return mockFetchResponse({
          ResponseCode: "0",
          ResultCode: "0",
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [{ Name: "MpesaReceiptNumber", Value: "QRYRECEIPT1" }],
          },
        });
      }
      if (url.includes("/b2c/")) {
        return mockFetchResponse({
          ResponseCode: "0",
          OriginatorConversationID: b2cOriginatorId,
          ConversationID: "conv-123",
        });
      }
      return mockFetchResponse({}, false);
    }),
  );
}

describe("M-Pesa STK integration", () => {
  const originalDev = process.env.ALLOW_DEV_PAYMENT_CONFIRM;
  const originalMpesaKey = process.env.MPESA_CONSUMER_KEY;
  const originalInitiator = process.env.MPESA_INITIATOR_NAME;

  beforeEach(() => {
    process.env.ALLOW_DEV_PAYMENT_CONFIRM = "false";
    process.env.MPESA_CONSUMER_KEY = "test-key";
    process.env.MPESA_CONSUMER_SECRET = "test-secret";
    process.env.MPESA_SHORTCODE = "174379";
    process.env.MPESA_PASS_KEY = "test-pass";
    delete process.env.MPESA_INITIATOR_NAME;
    delete process.env.MPESA_INITIATOR_PASSWORD;
    stubMpesaFetch();
  });

  afterEach(() => {
    process.env.ALLOW_DEV_PAYMENT_CONFIRM = originalDev;
    process.env.MPESA_CONSUMER_KEY = originalMpesaKey;
    if (originalInitiator) process.env.MPESA_INITIATOR_NAME = originalInitiator;
    else delete process.env.MPESA_INITIATOR_NAME;
    vi.unstubAllGlobals();
  });

  it("initiates STK and completes booking via callback", async () => {
    const app = buildTestApp();
    const passenger = await loginPassenger(app);

    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody);
    expect(created.status).toBe(201);

    const pay = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/pay`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ provider: "mpesa", phone: "+254712345678" });

    expect(pay.status).toBe(200);
    expect(pay.body.payment.status).toBe("pending");
    expect(pay.body.payment.mpesaCheckoutRequestId).toBe("ws_CO_TEST123");
    expect(pay.body.message).toMatch(/phone/i);

    const callback = await request(app)
      .post("/api/mpesa/stk-callback")
      .send({
        Body: {
          stkCallback: {
            CheckoutRequestID: "ws_CO_TEST123",
            ResultCode: 0,
            CallbackMetadata: {
              Item: [{ Name: "MpesaReceiptNumber", Value: "QAB1CD2EF3" }],
            },
          },
        },
      });
    expect(callback.status).toBe(200);

    const fetched = await request(app)
      .get(`/api/bookings/${created.body.booking.id}`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(fetched.body.booking.status).toBe("paid");
    expect(fetched.body.booking.payment.status).toBe("succeeded");
    expect(fetched.body.booking.payment.transactionRef).toBe("QAB1CD2EF3");

    await prisma.payment.deleteMany({ where: { bookingId: created.body.booking.id } });
    await prisma.booking.delete({ where: { id: created.body.booking.id } });
  });

  it("reconciles pending STK via payment-status poll", async () => {
    const app = buildTestApp();
    const passenger = await loginPassenger(app);

    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    await request(app)
      .post(`/api/bookings/${created.body.booking.id}/pay`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ provider: "mpesa", phone: "+254712345678" })
      .expect(200);

    const polled = await request(app)
      .get(`/api/bookings/${created.body.booking.id}/payment-status`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(polled.status).toBe(200);
    expect(polled.body.booking.status).toBe("paid");
    expect(polled.body.booking.payment.transactionRef).toBe("QRYRECEIPT1");

    await prisma.payment.deleteMany({ where: { bookingId: created.body.booking.id } });
    await prisma.booking.delete({ where: { id: created.body.booking.id } });
  });

  it("settles manual paybill via C2B confirmation", async () => {
    process.env.SONGA_MPESA_PAYBILL = "174379";
    const app = buildTestApp();
    const passenger = await loginPassenger(app);

    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    const pay = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/pay`)
      .set("Authorization", `Bearer ${passenger.token}`)
      .send({ provider: "mpesa", mpesaChannel: "paybill" })
      .expect(200);

    const accountRef = pay.body.manualPayment.accountReference as string;
    const amount = created.body.booking.total as number;

    const validation = await request(app)
      .post("/api/mpesa/c2b-validation")
      .send({
        TransID: "TXVAL001",
        TransAmount: String(amount),
        BillRefNumber: accountRef,
        BusinessShortCode: "174379",
      });
    expect(validation.status).toBe(200);
    expect(validation.body.ResultCode).toBe("0");

    await request(app)
      .post("/api/mpesa/c2b-confirmation")
      .send({
        TransID: "TXCONF001",
        TransAmount: String(amount),
        BillRefNumber: accountRef,
        BusinessShortCode: "174379",
      })
      .expect(200);

    const fetched = await request(app)
      .get(`/api/bookings/${created.body.booking.id}`)
      .set("Authorization", `Bearer ${passenger.token}`);
    expect(fetched.body.booking.status).toBe("paid");
    expect(fetched.body.booking.payment.transactionRef).toBe("TXCONF001");

    delete process.env.SONGA_MPESA_PAYBILL;
    await prisma.payment.deleteMany({ where: { bookingId: created.body.booking.id } });
    await prisma.booking.delete({ where: { id: created.body.booking.id } });
  });

  it("completes guest pay invite via STK callback", async () => {
    const app = buildTestApp();
    const passenger = await loginPassenger(app);

    const created = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${passenger.token}`)
      .send(bookingBody)
      .expect(201);

    const token = signBookingPayInvite({
      bookingId: created.body.booking.id,
      passengerId: passenger.userId,
      expiresInSeconds: 3600,
    });

    const pay = await request(app)
      .post(`/api/shared-rides/pay-invites/${encodeURIComponent(token)}/pay`)
      .send({ provider: "mpesa", phone: "+254712345678" })
      .expect(200);
    expect(pay.body.payment.mpesaCheckoutRequestId).toBe("ws_CO_TEST123");

    await request(app)
      .post("/api/mpesa/stk-callback")
      .send({
        Body: {
          stkCallback: {
            CheckoutRequestID: "ws_CO_TEST123",
            ResultCode: 0,
            CallbackMetadata: {
              Item: [{ Name: "MpesaReceiptNumber", Value: "INVRECEIPT1" }],
            },
          },
        },
      })
      .expect(200);

    const summary = await request(app)
      .get(`/api/shared-rides/pay-invites/${encodeURIComponent(token)}`)
      .expect(200);
    expect(summary.body.booking.status).toBe("paid");

    await prisma.payment.deleteMany({ where: { bookingId: created.body.booking.id } });
    await prisma.booking.delete({ where: { id: created.body.booking.id } });
  });
});

describe("M-Pesa B2C integration", () => {
  const originalDev = process.env.ALLOW_DEV_PAYMENT_CONFIRM;
  const originalMpesaKey = process.env.MPESA_CONSUMER_KEY;
  const originalInitiator = process.env.MPESA_INITIATOR_NAME;
  const originalInitiatorPw = process.env.MPESA_INITIATOR_PASSWORD;
  const originalCert = process.env.MPESA_CERTIFICATE_PATH;

  beforeEach(() => {
    process.env.ALLOW_DEV_PAYMENT_CONFIRM = "false";
    process.env.MPESA_CONSUMER_KEY = "test-key";
    process.env.MPESA_CONSUMER_SECRET = "test-secret";
    process.env.MPESA_SHORTCODE = "174379";
    process.env.MPESA_PASS_KEY = "test-pass";
    process.env.MPESA_INITIATOR_NAME = "test-initiator";
    process.env.MPESA_INITIATOR_PASSWORD = "test-password";
    process.env.MPESA_CERTIFICATE_PATH = "tests/fixtures/mpesa-test.cer";
    stubMpesaFetch("ws_CO_B2C", "origin-b2c-456");
  });

  afterEach(() => {
    process.env.ALLOW_DEV_PAYMENT_CONFIRM = originalDev;
    process.env.MPESA_CONSUMER_KEY = originalMpesaKey;
    if (originalInitiator) process.env.MPESA_INITIATOR_NAME = originalInitiator;
    else delete process.env.MPESA_INITIATOR_NAME;
    if (originalInitiatorPw) process.env.MPESA_INITIATOR_PASSWORD = originalInitiatorPw;
    else delete process.env.MPESA_INITIATOR_PASSWORD;
    if (originalCert) process.env.MPESA_CERTIFICATE_PATH = originalCert;
    else delete process.env.MPESA_CERTIFICATE_PATH;
    vi.unstubAllGlobals();
  });

  async function seedDriverBalance(app: Express, driverToken: string) {
    const passenger = await createAuthSession(app, "+254716000077", "passenger", { name: "Ride Payer" });
    await setupDriverForDispatch(app, driverToken, { lat: -1.2674, lng: 36.807 });
    const ride = await request(app)
      .post("/api/rides/request")
      .set("Authorization", `Bearer ${passenger.sessionToken}`)
      .send({
        pickup: { label: "Westlands", lat: -1.2674, lng: 36.807 },
        dropoff: { label: "Kilimani", lat: -1.2921, lng: 36.7856 },
        prepaid: false,
        paymentMethod: null,
      })
      .expect(201);
    const rideId = ride.body.ride.id as string;
    await request(app).post(`/api/rides/${rideId}/accept`).set("Authorization", `Bearer ${driverToken}`).expect(200);
    await request(app).post(`/api/rides/${rideId}/arrived`).set("Authorization", `Bearer ${driverToken}`).expect(200);
    await request(app).post(`/api/rides/${rideId}/start`).set("Authorization", `Bearer ${driverToken}`).expect(200);
    await request(app).post(`/api/rides/${rideId}/complete`).set("Authorization", `Bearer ${driverToken}`).expect(200);
    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driverToken}`)
      .expect(200);
    return wallet.body.balance as number;
  }

  it("completes B2C cashout via callback", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);
    const balance = await seedDriverBalance(app, driver.token);
    const amount = Math.min(100, balance);

    const cashout = await request(app)
      .post("/api/drivers/me/wallet/cashout")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ amount, method: "mpesa", phone: "+254727000001" })
      .expect(200);
    expect(cashout.body.transaction.status).toBe("pending");

    await request(app)
      .post("/api/mpesa/b2c-callback")
      .send({
        Result: {
          OriginatorConversationID: "origin-b2c-456",
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
        },
      })
      .expect(200);

    const wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`)
      .expect(200);
    expect(wallet.body.pendingPayout).toBe(0);
    const debit = wallet.body.transactions.find((tx: { amount: number }) => tx.amount === -amount);
    expect(debit?.status).toBe("posted");
  });

  it("refunds wallet on B2C failure and timeout", async () => {
    const app = buildTestApp();
    const driver = await loginDriver(app);
    const balance = await seedDriverBalance(app, driver.token);
    const amount = Math.min(50, balance);

    await request(app)
      .post("/api/drivers/me/wallet/cashout")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ amount, method: "mpesa", phone: "+254727000001" })
      .expect(200);

    await request(app)
      .post("/api/mpesa/b2c-callback")
      .send({
        Result: {
          OriginatorConversationID: "origin-b2c-456",
          ResultCode: 1,
          ResultDesc: "Insufficient funds",
        },
      })
      .expect(200);

    let wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`)
      .expect(200);
    expect(wallet.body.pendingPayout).toBe(0);
    expect(wallet.body.balance).toBe(balance);

    await request(app)
      .post("/api/drivers/me/wallet/cashout")
      .set("Authorization", `Bearer ${driver.token}`)
      .send({ amount, method: "mpesa", phone: "+254727000001" })
      .expect(200);

    await request(app)
      .post("/api/mpesa/b2c-timeout")
      .send({
        Result: {
          OriginatorConversationID: "origin-b2c-456",
          ResultCode: 1,
          ResultDesc: "Timed out",
        },
      })
      .expect(200);

    wallet = await request(app)
      .get("/api/drivers/me/wallet")
      .set("Authorization", `Bearer ${driver.token}`)
      .expect(200);
    expect(wallet.body.pendingPayout).toBe(0);
    expect(wallet.body.balance).toBe(balance);
  });
});
