import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import type { SmsMessage, SmsProvider } from "../src/lib/sms.js";
import { _setSmsProvider } from "../src/lib/sms.js";
import { buildTestApp, createAuthSession, TEST_PASSWORD } from "./helpers.js";

const PHONE = "+254712345678";
const PHONE_2 = "+254722333444";
const NEW_PASSWORD = "5678";
const EMAIL = "forgot-reset@example.com";

class RecordingSmsProvider implements SmsProvider {
  readonly name = "console" as const;
  readonly sent: SmsMessage[] = [];

  async send(msg: SmsMessage) {
    this.sent.push(msg);
    return { ok: true, provider: "console" as const, id: "test_1" };
  }
}

async function requestForgotCode(
  app: ReturnType<typeof buildTestApp>,
  identifier: string,
  role: "passenger" | "driver" = "passenger",
): Promise<string> {
  const res = await request(app)
    .post("/api/auth/password/forgot")
    .set("x-dev-show-otp", "1")
    .send({ identifier, role });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.expiresInSeconds).toBe(300);
  const devCode = res.body.devCode as string | undefined;
  if (!devCode) {
    throw new Error("forgot: devCode missing (set x-dev-show-otp: 1 and ensure account exists)");
  }
  return devCode;
}

describe("POST /api/auth/password/forgot", () => {
  afterEach(() => {
    _setSmsProvider(null);
  });

  it("returns ok without devCode for unknown identifier (no enumeration leak)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/password/forgot")
      .set("x-dev-show-otp", "1")
      .send({ identifier: "+254700000000", role: "passenger" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.devCode).toBeUndefined();
  });

  it("returns devCode for a verified account", async () => {
    const app = buildTestApp();
    await createAuthSession(app, PHONE, "passenger");
    const res = await request(app)
      .post("/api/auth/password/forgot")
      .set("x-dev-show-otp", "1")
      .send({ identifier: PHONE, role: "passenger" });
    expect(res.status).toBe(200);
    expect(res.body.devCode).toMatch(/^\d{6}$/);
  });

  it("works when identifier is the account email", async () => {
    const app = buildTestApp();
    await createAuthSession(app, PHONE_2, "passenger", { email: EMAIL });
    const res = await request(app)
      .post("/api/auth/password/forgot")
      .set("x-dev-show-otp", "1")
      .send({ identifier: EMAIL, role: "passenger" });
    expect(res.status).toBe(200);
    expect(res.body.devCode).toMatch(/^\d{6}$/);
  });

  it("dispatches reset OTP SMS to the account phone", async () => {
    const sms = new RecordingSmsProvider();
    _setSmsProvider(sms);
    const app = buildTestApp();
    await createAuthSession(app, PHONE, "driver");

    const res = await request(app)
      .post("/api/auth/password/forgot")
      .send({ identifier: PHONE, role: "driver" });

    expect(res.status).toBe(200);
    const resetSms = sms.sent.filter((m) => /password reset code is \d{6}/.test(m.body));
    expect(resetSms).toHaveLength(1);
    expect(resetSms[0]?.to).toBe(PHONE);
  });

  it("returns 503 when SMS delivery fails for configured provider", async () => {
    const app = buildTestApp();
    await createAuthSession(app, PHONE, "passenger");

    const failing: SmsProvider = {
      name: "wasiliana",
      send: vi.fn().mockResolvedValue({
        ok: false,
        provider: "wasiliana",
        error: "Wasiliana returned 401",
      }),
    };
    _setSmsProvider(failing);
    process.env.WASILIANA_API_KEY = "configured-for-test";

    const res = await request(app)
      .post("/api/auth/password/forgot")
      .send({ identifier: PHONE, role: "passenger" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SMS_DELIVERY_FAILED");

    delete process.env.WASILIANA_API_KEY;
  });

  it("rejects invalid role", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/password/forgot")
      .send({ identifier: PHONE, role: "admin" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ROLE");
  });
});

describe("POST /api/auth/password/reset", () => {
  it("rejects invalid OTP", async () => {
    const app = buildTestApp();
    await createAuthSession(app, PHONE, "passenger");
    await requestForgotCode(app, PHONE);

    const res = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: PHONE,
        role: "passenger",
        code: "000000",
        password: NEW_PASSWORD,
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_OTP");
  });

  it("rejects weak password", async () => {
    const app = buildTestApp();
    await createAuthSession(app, PHONE, "passenger");
    const code = await requestForgotCode(app, PHONE);

    const res = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: PHONE,
        role: "passenger",
        code,
        password: "short",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEAK_PASSWORD");
  });

  it("updates password, signs in, and rejects old password", async () => {
    const app = buildTestApp();
    const { sessionToken: oldSession } = await createAuthSession(app, PHONE, "passenger");
    const code = await requestForgotCode(app, PHONE);

    const reset = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: PHONE,
        role: "passenger",
        code,
        password: NEW_PASSWORD,
      });
    expect(reset.status).toBe(200);
    expect(reset.body.ok).toBe(true);
    expect(reset.body.sessionToken).toBeTruthy();
    expect(reset.body.user.phone).toBe(PHONE);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ identifier: PHONE, password: TEST_PASSWORD, role: "passenger" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ identifier: PHONE, password: NEW_PASSWORD, role: "passenger" });
    expect(newLogin.status).toBe(200);

    const meOld = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${oldSession}`);
    expect(meOld.status).toBe(401);

    const meNew = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${reset.body.sessionToken}`);
    expect(meNew.status).toBe(200);
  });

  it("consumes OTP one-shot — same code cannot be reused", async () => {
    const app = buildTestApp();
    await createAuthSession(app, PHONE, "passenger");
    const code = await requestForgotCode(app, PHONE);

    const first = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: PHONE,
        role: "passenger",
        code,
        password: NEW_PASSWORD,
      });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: PHONE,
        role: "passenger",
        code,
        password: "9012",
      });
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe("INVALID_OTP");
  });

  it("works when forgot was requested by email", async () => {
    const app = buildTestApp();
    await createAuthSession(app, PHONE_2, "passenger", { email: EMAIL });
    const code = await requestForgotCode(app, EMAIL);

    const reset = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: EMAIL,
        role: "passenger",
        code,
        password: NEW_PASSWORD,
      });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: EMAIL, password: NEW_PASSWORD, role: "passenger" });
    expect(login.status).toBe(200);
  });

  it("returns INVALID_OTP when no account exists (even with guessed code)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: "+254700000001",
        role: "passenger",
        code: "123456",
        password: NEW_PASSWORD,
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_OTP");
  });

  it("revokes all prior sessions for the user", async () => {
    const app = buildTestApp();
    const { user } = await createAuthSession(app, PHONE, "passenger");

    const extraLogin = await request(app)
      .post("/api/auth/login")
      .send({ identifier: PHONE, password: TEST_PASSWORD, role: "passenger" });
    expect(extraLogin.status).toBe(200);

    const before = await prisma.session.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(before).toBeGreaterThanOrEqual(2);

    const code = await requestForgotCode(app, PHONE);
    const reset = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: PHONE,
        role: "passenger",
        code,
        password: NEW_PASSWORD,
      });
    expect(reset.status).toBe(200);

    const after = await prisma.session.findMany({ where: { userId: user.id } });
    const revoked = after.filter((s) => s.revokedAt !== null);
    const active = after.filter((s) => s.revokedAt === null);
    expect(revoked.length).toBeGreaterThanOrEqual(before);
    expect(active).toHaveLength(1);
    expect(active[0]?.tokenHash).toBeTruthy();
  });

  it("sets session cookie for browser clients", async () => {
    const app = buildTestApp();
    await createAuthSession(app, PHONE, "passenger");
    const code = await requestForgotCode(app, PHONE);

    const res = await request(app)
      .post("/api/auth/password/reset")
      .set(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      )
      .send({
        identifier: PHONE,
        role: "passenger",
        code,
        password: NEW_PASSWORD,
      });
    expect(res.status).toBe(200);
    const cookie = res.headers["set-cookie"];
    expect(cookie).toBeDefined();
    const cookieStr = Array.isArray(cookie) ? cookie.join(";") : String(cookie);
    expect(cookieStr).toContain("songa_session=");
  });
});

describe("forgot password end-to-end", () => {
  it("full flow: register → login → forgot → reset → login with new password", async () => {
    const app = buildTestApp();
    const phone = "+254733111222";

    await createAuthSession(app, phone, "passenger", { name: "Reset User" });

    const code = await requestForgotCode(app, phone);
    const reset = await request(app)
      .post("/api/auth/password/reset")
      .send({
        identifier: phone,
        role: "passenger",
        code,
        password: NEW_PASSWORD,
      });
    expect(reset.status).toBe(200);
    expect(reset.body.user.name).toBe("Reset User");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: phone, password: NEW_PASSWORD, role: "passenger" });
    expect(login.status).toBe(200);
    expect(login.body.user.name).toBe("Reset User");
  });
});
