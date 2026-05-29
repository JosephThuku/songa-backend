// /api/auth/* — register → confirm OTP → login (phone/email + password).

import { Router } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { SESSION_TTL_SECONDS } from "../lib/jwt.js";
import {
  ConfirmRegistrationRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
} from "../schemas/auth.schema.js";
import { rateLimit, requestIp } from "../middleware/rate-limit.js";
import {
  requireAuth,
  SESSION_COOKIE_NAME,
} from "../middleware/require-auth.js";
import {
  confirmRegistration,
  getMe,
  isWebClient,
  login,
  logout,
  register,
} from "../services/auth.service.js";

const router: Router = Router();

function parseBody<T>(
  schema: { safeParse: (body: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[] }[] } } },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "role") {
      throw new AppError("INVALID_ROLE", 400, "Invalid role.");
    }
    if (issue?.path[0] === "password") {
      throw new AppError("WEAK_PASSWORD", 400, "Password does not meet requirements.");
    }
    throw new AppError("INVALID_INPUT", 400, "Invalid input.");
  }
  return parsed.data;
}

// ---------- POST /api/auth/register ----------
router.post(
  "/register",
  rateLimit({
    prefix: "auth:register:ip",
    max: 10,
    windowMs: 60 * 1000,
    identifier: (req) => requestIp(req),
    message: "Too many registration attempts. Try again in a minute.",
  }),
  rateLimit({
    prefix: "auth:register:phone",
    max: 3,
    windowMs: 15 * 60 * 1000,
    identifier: (req) => {
      const phone = (req.body as { phone?: unknown })?.phone;
      return typeof phone === "string" && phone.length > 0 ? phone : null;
    },
    message: "Too many registration attempts for this phone. Try again later.",
  }),
  asyncHandler(async (req, res) => {
    const data = parseBody(RegisterRequestSchema, req.body);
    const result = await register({
      phone: data.phone,
      role: data.role,
      password: data.password,
      name: data.name,
      email: data.email,
    });
    const showDevCode = process.env.NODE_ENV !== "production" && req.header("x-dev-show-otp") === "1";
    const body: { ok: true; expiresInSeconds: number; devCode?: string } = {
      ok: true,
      expiresInSeconds: result.expiresInSeconds,
    };
    if (showDevCode && result.devCode) body.devCode = result.devCode;
    res.status(200).json(body);
  }),
);

// ---------- POST /api/auth/register/confirm ----------
router.post(
  "/register/confirm",
  rateLimit({
    prefix: "auth:register:confirm:phone",
    max: 5,
    windowMs: 5 * 60 * 1000,
    identifier: (req) => {
      const phone = (req.body as { phone?: unknown })?.phone;
      return typeof phone === "string" && phone.length > 0 ? phone : null;
    },
    message: "Too many confirmation attempts. Request a new code.",
  }),
  asyncHandler(async (req, res) => {
    const data = parseBody(ConfirmRegistrationRequestSchema, req.body);
    const ua = req.header("user-agent") ?? null;
    const result = await confirmRegistration({
      phone: data.phone,
      role: data.role,
      code: data.code,
      ip: requestIp(req),
      userAgent: ua,
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

    res.status(200).json(result);
  }),
);

// ---------- POST /api/auth/login ----------
router.post(
  "/login",
  rateLimit({
    prefix: "auth:login:ip",
    max: 20,
    windowMs: 60 * 1000,
    identifier: (req) => requestIp(req),
    message: "Too many login attempts. Try again in a minute.",
  }),
  rateLimit({
    prefix: "auth:login:identifier",
    max: 10,
    windowMs: 15 * 60 * 1000,
    identifier: (req) => {
      const id = (req.body as { identifier?: unknown })?.identifier;
      return typeof id === "string" && id.length > 0 ? id : null;
    },
    message: "Too many login attempts. Try again later.",
  }),
  asyncHandler(async (req, res) => {
    const data = parseBody(LoginRequestSchema, req.body);
    const ua = req.header("user-agent") ?? null;
    const result = await login({
      identifier: data.identifier,
      password: data.password,
      role: data.role,
      userAgent: ua,
      ip: requestIp(req),
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
    });
  }),
);

// ---------- POST /api/auth/logout ----------
router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
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
