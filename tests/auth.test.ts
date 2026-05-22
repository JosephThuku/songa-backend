// Stage 1 integration tests for /api/auth/*.
// One `it()` per bullet in STAGE_1_PLAN.md §8 "Test list".

import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, sendOtpAndGetCode } from "./helpers.js";

const VALID_PHONE = "+254712345678";
const VALID_PHONE_2 = "+254722333444";

describe("POST /api/auth/otp/send", () => {
  it("rejects an invalid phone with 400 INVALID_PHONE", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/otp/send")
      .send({ phone: "not-a-phone", role: "passenger" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PHONE");
  });

  it("rejects an invalid role with 400 INVALID_ROLE", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/otp/send")
      .send({ phone: VALID_PHONE, role: "admin" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ROLE");
  });

  it("returns 200 + expiresInSeconds:300 for a valid Kenya phone", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/otp/send")
      .send({ phone: VALID_PHONE, role: "passenger" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.expiresInSeconds).toBe(300);
    expect(res.body.devCode).toBeUndefined(); // no dev header set
  });

  it("returns devCode when x-dev-show-otp:1 is set and NODE_ENV != production", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/otp/send")
      .set("x-dev-show-otp", "1")
      .send({ phone: VALID_PHONE, role: "passenger" });
    expect(res.status).toBe(200);
    expect(res.body.devCode).toMatch(/^\d{6}$/);
  });

  it("does NOT return devCode when NODE_ENV=production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = buildTestApp();
      const res = await request(app)
        .post("/api/auth/otp/send")
        .set("x-dev-show-otp", "1")
        .send({ phone: VALID_PHONE, role: "passenger" });
      expect(res.status).toBe(200);
      expect(res.body.devCode).toBeUndefined();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("rate-limits the 4th send to the same phone within 15 minutes (429 RATE_LIMITED)", async () => {
    const app = buildTestApp();
    // 3 are allowed; the 4th must 429.
    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post("/api/auth/otp/send")
        .send({ phone: VALID_PHONE, role: "passenger" });
      expect(r.status).toBe(200);
    }
    const r4 = await request(app)
      .post("/api/auth/otp/send")
      .send({ phone: VALID_PHONE, role: "passenger" });
    expect(r4.status).toBe(429);
    expect(r4.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("POST /api/auth/otp/verify", () => {
  it("returns 401 INVALID_OTP when no OTP was sent for that phone", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: "123456" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_OTP");
  });

  it("returns 401 INVALID_OTP when the code is wrong", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE, "passenger");
    // Construct a different 6-digit string than the issued code.
    const wrong = devCode === "000000" ? "111111" : "000000";
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: wrong });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_OTP");
  });

  it("happy path returns 200 + sessionToken + §2.3 user shape for passenger", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE, "passenger");
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: devCode });

    expect(res.status).toBe(200);
    expect(typeof res.body.sessionToken).toBe("string");
    expect(res.body.sessionToken.length).toBeGreaterThan(20);

    const user = res.body.user;
    expect(user).toEqual({
      id: expect.stringMatching(/^usr_/),
      role: "passenger",
      name: null,
      phone: VALID_PHONE,
      email: null,
      avatarUrl: null,
      rating: 5,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    // Passenger MUST NOT have driverProfile.
    expect(user.driverProfile).toBeUndefined();
  });

  it("for a driver, user includes driverProfile with onboardingStatus=approved", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE, "driver");
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "driver", code: devCode });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("driver");
    expect(res.body.user.driverProfile).toEqual({
      isOnline: false,
      acceptanceRate: 100,
      vehicleId: null,
      onboardingStatus: "approved",
    });
  });

  it("creates a Session row and an OtpAttempt success=true on happy path", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE, "passenger");
    const before = await prisma.session.count();
    const res = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: devCode });
    expect(res.status).toBe(200);

    const after = await prisma.session.count();
    expect(after).toBe(before + 1);

    const userId: string = res.body.user.id;
    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].revokedAt).toBeNull();
    expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    const successes = await prisma.otpAttempt.count({
      where: { phone: VALID_PHONE, success: true },
    });
    expect(successes).toBe(1);
  });

  it("is one-shot — reusing the same code immediately returns 401", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE, "passenger");
    const r1 = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: devCode });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: devCode });
    expect(r2.status).toBe(401);
    expect(r2.body.error.code).toBe("INVALID_OTP");
  });

  it("same phone can verify as passenger AND driver → two distinct user ids", async () => {
    const app = buildTestApp();

    const p = await sendOtpAndGetCode(app, VALID_PHONE, "passenger");
    const rp = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: p.devCode });
    expect(rp.status).toBe(200);

    const d = await sendOtpAndGetCode(app, VALID_PHONE, "driver");
    const rd = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "driver", code: d.devCode });
    expect(rd.status).toBe(200);

    expect(rp.body.user.id).not.toBe(rd.body.user.id);
    expect(rp.body.user.role).toBe("passenger");
    expect(rd.body.user.role).toBe("driver");
    expect(rp.body.user.phone).toBe(rd.body.user.phone);
  });
});

describe("GET /api/auth/me", () => {
  it("without Authorization returns 401 UNAUTHORIZED", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("with a valid Bearer token returns the §2.4 shape (driver case includes driverProfile)", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE, "driver");
    const v = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "driver", code: devCode });
    expect(v.status).toBe(200);
    const token: string = v.body.sessionToken;

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({
      id: expect.stringMatching(/^usr_/),
      role: "driver",
      name: null,
      phone: VALID_PHONE,
      email: null,
      avatarUrl: null,
      rating: 5,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      driverProfile: {
        isOnline: false,
        acceptanceRate: 100,
        vehicleId: null,
        onboardingStatus: "approved",
      },
    });
  });

  it("with an expired token returns 401", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE, "passenger");
    const v = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: devCode });
    expect(v.status).toBe(200);

    // Forge an expired token with the SAME secret so signature is valid,
    // but exp is in the past. (Session row in DB still exists.)
    const expired = jwt.sign(
      {
        sub: v.body.user.id,
        role: "passenger",
        sid: "sess_does_not_matter",
        iat: Math.floor(Date.now() / 1000) - 10 * 60,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      process.env.SESSION_JWT_SECRET as string,
      { algorithm: "HS256" },
    );

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("with a revoked session (post-logout) returns 401", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE, "passenger");
    const v = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE, role: "passenger", code: devCode });
    const token: string = v.body.sessionToken;

    const out = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(out.status).toBe(200);

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and subsequent /me returns 401", async () => {
    const app = buildTestApp();
    const { devCode } = await sendOtpAndGetCode(app, VALID_PHONE_2, "passenger");
    const v = await request(app)
      .post("/api/auth/otp/verify")
      .send({ phone: VALID_PHONE_2, role: "passenger", code: devCode });
    expect(v.status).toBe(200);
    const token: string = v.body.sessionToken;

    // /me works before logout
    const meBefore = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meBefore.status).toBe(200);

    const out = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });

    // DB side-effect: revokedAt is set
    const sessions = await prisma.session.findMany({
      where: { userId: v.body.user.id },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].revokedAt).not.toBeNull();

    const meAfter = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(meAfter.status).toBe(401);
    expect(meAfter.body.error.code).toBe("UNAUTHORIZED");
  });
});
