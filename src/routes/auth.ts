// /api/auth/* routes. Request schemas live in src/schemas/auth.schema.ts
// (single source of truth for both runtime validation and OpenAPI docs).

import { Router } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { SESSION_TTL_SECONDS } from "../lib/jwt.js";
import {
  SendOtpRequestSchema as sendOtpBodySchema,
  VerifyOtpRequestSchema as verifyOtpBodySchema,
} from "../schemas/auth.schema.js";
import { rateLimit, requestIp } from "../middleware/rate-limit.js";
import {
  requireAuth,
  SESSION_COOKIE_NAME,
} from "../middleware/require-auth.js";
import {
  getMe,
  isWebClient,
  logout,
  sendOtp,
  verifyOtp,
} from "../services/auth.service.js";

const router: Router = Router();

// ---------- POST /api/auth/otp/send ----------
router.post(
  "/otp/send",
  rateLimit({
    prefix: "otp:send:ip",
    max: 10,
    windowMs: 60 * 1000, // 1 min
    identifier: (req) => requestIp(req),
    message: "Too many OTP requests from this network. Try again in a minute.",
  }),
  rateLimit({
    prefix: "otp:send:phone",
    max: 3,
    windowMs: 15 * 60 * 1000, // 15 min
    identifier: (req) => {
      const phone = (req.body as { phone?: unknown })?.phone;
      return typeof phone === "string" && phone.length > 0 ? phone : null;
    },
    message: "Too many OTP requests for this phone. Try again later.",
  }),
  asyncHandler(async (req, res) => {
    const parsed = sendOtpBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path[0] === "role") {
        throw new AppError("INVALID_ROLE", 400, "Invalid role.");
      }
      throw new AppError("INVALID_INPUT", 400, "Invalid input.", {
        issues: parsed.error.issues,
      });
    }

    const result = await sendOtp({ phone: parsed.data.phone, role: parsed.data.role });
    const isDev = process.env.NODE_ENV !== "production";
    const showDevCode = isDev && req.header("x-dev-show-otp") === "1";
    const body: { ok: true; expiresInSeconds: number; devCode?: string } = {
      ok: true,
      expiresInSeconds: result.expiresInSeconds,
    };
    if (showDevCode && result.devCode) body.devCode = result.devCode;
    res.status(200).json(body);
  }),
);

// ---------- POST /api/auth/otp/verify ----------
router.post(
  "/otp/verify",
  rateLimit({
    prefix: "otp:verify:phone",
    max: 5,
    windowMs: 5 * 60 * 1000, // 5 min
    identifier: (req) => {
      const phone = (req.body as { phone?: unknown })?.phone;
      return typeof phone === "string" && phone.length > 0 ? phone : null;
    },
    message: "Too many verify attempts. Request a new code.",
  }),
  asyncHandler(async (req, res) => {
    const parsed = verifyOtpBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path[0] === "role") {
        throw new AppError("INVALID_ROLE", 400, "Invalid role.");
      }
      throw new AppError("INVALID_INPUT", 400, "Invalid input.", {
        issues: parsed.error.issues,
      });
    }

    const ua = req.header("user-agent") ?? null;
    const ip = requestIp(req);

    const result = await verifyOtp({
      phone: parsed.data.phone,
      role: parsed.data.role,
      code: parsed.data.code,
      userAgent: ua,
      ip,
      name: parsed.data.name,
      email: parsed.data.email,
    });

    if (isWebClient(ua)) {
      res.cookie(SESSION_COOKIE_NAME, result.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_TTL_SECONDS * 1000,
        path: "/",
      });
    }

    res.status(200).json({
      sessionToken: result.sessionToken,
      user: result.user,
      isNewUser: result.isNewUser,
    });
  }),
);

// ---------- POST /api/auth/logout ----------
router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      // requireAuth ensures this, but TypeScript narrowing
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Auth required." } });
      return;
    }
    await logout(req.user.sessionId);
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(200).json({ ok: true });
  }),
);

// ---------- GET /api/auth/me ----------
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Auth required." } });
      return;
    }
    const result = await getMe(req.user.id);
    res.status(200).json(result);
  }),
);

export default router;
