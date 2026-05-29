import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

const PASSENGER_PHONE = "+254716000099";

const bookingBody = {
  pickup: { label: "JKIA Terminal 1A", lat: -1.3192, lng: 36.9278 },
  dropoff: { label: "Westlands", lat: -1.2674, lng: 36.807 },
  seats: [1],
};

async function login(app: Express) {
  const session = await createAuthSession(app, PASSENGER_PHONE, "passenger", { name: "Mpesa Passenger" });
  return { token: session.sessionToken };
}

function mockFetchResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
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

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/oauth/")) {
          return mockFetchResponse({ access_token: "tok" });
        }
        if (url.includes("/stkpush/")) {
          return mockFetchResponse({
            ResponseCode: "0",
            CheckoutRequestID: "ws_CO_TEST123",
            CustomerMessage: "Success. Request accepted for processing",
          });
        }
        return mockFetchResponse({}, false);
      }),
    );
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
    const passenger = await login(app);

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
});
