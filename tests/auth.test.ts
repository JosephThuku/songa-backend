import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { buildTestApp, createAuthSession, TEST_PASSWORD } from "./helpers.js";

const VALID_PHONE = "+254712345678";
const VALID_PHONE_2 = "+254722333444";

describe("POST /api/auth/register", () => {
  it("rejects weak password", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ phone: VALID_PHONE, role: "passenger", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEAK_PASSWORD");
  });

  it("returns devCode with x-dev-show-otp in non-production", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .set("x-dev-show-otp", "1")
      .send({ phone: VALID_PHONE, role: "passenger", password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.devCode).toMatch(/^\d{6}$/);
  });

  it("returns 409 when registering an already verified account", async () => {
    const app = buildTestApp();
    await createAuthSession(app, VALID_PHONE_2, "passenger");
    const res = await request(app)
      .post("/api/auth/register")
      .send({ phone: VALID_PHONE_2, role: "passenger", password: TEST_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USER_EXISTS");
  });
});

describe("POST /api/auth/register/confirm", () => {
  it("returns 401 for invalid OTP", async () => {
    const app = buildTestApp();
    await request(app)
      .post("/api/auth/register")
      .set("x-dev-show-otp", "1")
      .send({ phone: VALID_PHONE, role: "passenger", password: TEST_PASSWORD });
    const res = await request(app)
      .post("/api/auth/register/confirm")
      .send({ phone: VALID_PHONE, role: "passenger", code: "000000" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_OTP");
  });

  it("creates user without session token", async () => {
    const app = buildTestApp();
    const reg = await request(app)
      .post("/api/auth/register")
      .set("x-dev-show-otp", "1")
      .send({
        phone: VALID_PHONE,
        role: "driver",
        password: TEST_PASSWORD,
        name: "Driver One",
      });
    const confirm = await request(app)
      .post("/api/auth/register/confirm")
      .send({ phone: VALID_PHONE, role: "driver", code: reg.body.devCode });
    expect(confirm.status).toBe(200);
    expect(confirm.body.ok).toBe(true);
    expect(confirm.body.user.phone).toBe(VALID_PHONE);
    expect(confirm.body.user.driverProfile?.onboardingStatus).toBe("approved");
    expect(confirm.body.sessionToken).toBeUndefined();
  });
});

describe("POST /api/auth/login", () => {
  it("returns 401 for wrong password", async () => {
    const app = buildTestApp();
    const reg = await request(app)
      .post("/api/auth/register")
      .set("x-dev-show-otp", "1")
      .send({ phone: VALID_PHONE, role: "passenger", password: TEST_PASSWORD });
    await request(app)
      .post("/api/auth/register/confirm")
      .send({ phone: VALID_PHONE, role: "passenger", code: reg.body.devCode });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ identifier: VALID_PHONE, password: "WrongPass99", role: "passenger" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("happy path returns sessionToken and user", async () => {
    const app = buildTestApp();
    const { sessionToken, user } = await createAuthSession(app, VALID_PHONE, "passenger", {
      name: "Jane",
      email: "jane@example.com",
    });
    expect(sessionToken).toBeTruthy();
    expect(user.name).toBe("Jane");
    expect(user.email).toBe("jane@example.com");

    const session = await prisma.session.findFirst({ where: { userId: user.id } });
    expect(session).toBeTruthy();
  });

  it("allows login with email", async () => {
    const app = buildTestApp();
    await createAuthSession(app, VALID_PHONE_2, "passenger", {
      email: "login-by-email@example.com",
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        identifier: "login-by-email@example.com",
        password: TEST_PASSWORD,
        role: "passenger",
      });
    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toBeTruthy();
  });
});

describe("GET /api/auth/me and POST /api/auth/logout", () => {
  it("me returns user; logout revokes session", async () => {
    const app = buildTestApp();
    const { sessionToken } = await createAuthSession(app, VALID_PHONE, "passenger");

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${sessionToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.phone).toBe(VALID_PHONE);

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${sessionToken}`);
    expect(logout.status).toBe(200);

    const me2 = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${sessionToken}`);
    expect(me2.status).toBe(401);
  });

  it("rejects tampered JWT", async () => {
    const app = buildTestApp();
    const { sessionToken } = await createAuthSession(app, VALID_PHONE, "passenger");
    const decoded = jwt.decode(sessionToken) as { sid: string };
    const bad = jwt.sign(
      { sub: "usr_fake", role: "passenger", sid: decoded.sessionId },
      process.env.SESSION_JWT_SECRET!,
    );
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });
});
