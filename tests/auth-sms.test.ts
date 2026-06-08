import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmsMessage, SmsProvider } from "../src/lib/sms.js";
import { _setSmsProvider } from "../src/lib/sms.js";
import { buildTestApp, TEST_PASSWORD } from "./helpers.js";

class RecordingSmsProvider implements SmsProvider {
  readonly name = "console" as const;
  readonly sent: SmsMessage[] = [];

  async send(msg: SmsMessage) {
    this.sent.push(msg);
    return { ok: true, provider: "console" as const, id: "test_1" };
  }
}

describe("POST /api/auth/register OTP SMS", () => {
  afterEach(() => {
    _setSmsProvider(null);
  });

  it("dispatches OTP SMS on register", async () => {
    const sms = new RecordingSmsProvider();
    _setSmsProvider(sms);
    const app = buildTestApp();

    const res = await request(app)
      .post("/api/auth/register")
      .set("x-dev-show-otp", "1")
      .send({ phone: "+254798765432", role: "passenger", password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.to).toBe("+254798765432");
    expect(sms.sent[0]?.isOtp).toBe(true);
    expect(sms.sent[0]?.body).toMatch(/Your Songa code is \d{6}/);
  });

  it("returns 503 when Wasiliana SMS fails", async () => {
    const failing: SmsProvider = {
      name: "wasiliana",
      send: vi.fn().mockResolvedValue({
        ok: false,
        provider: "wasiliana",
        error: "Wasiliana returned 401: App does not match your api key",
      }),
    };
    _setSmsProvider(failing);
    process.env.WASILIANA_API_KEY = "configured-for-test";

    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ phone: "+254798765433", role: "passenger", password: TEST_PASSWORD });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SMS_DELIVERY_FAILED");

    delete process.env.WASILIANA_API_KEY;
  });
});
