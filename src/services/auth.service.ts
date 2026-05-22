// NEW — auth service: sendOtp, verifyOtp, logout, getMe.

import cuid from "cuid";
import { OnboardingStatus, UserRole } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { hashToken, signSessionToken, SESSION_TTL_SECONDS } from "../lib/jwt.js";
import { logger } from "../lib/logger.js";
import {
  consumeOtp,
  generateOtpCode,
  OTP_TTL_SECONDS,
  storeOtp,
} from "../lib/otp.js";
import { normalizePhone } from "../lib/phone.js";
import { prisma } from "../lib/prisma.js";
import { getRedis } from "../lib/redis.js";
import { toUserDto, type UserDto } from "../lib/responses.js";
import { getSmsProvider } from "../lib/sms.js";

export type Role = "passenger" | "driver";

export interface SendOtpInput {
  phone: string;
  role: Role;
}

export interface SendOtpResult {
  ok: true;
  expiresInSeconds: number;
  devCode?: string;
  phone: string;
}

export interface VerifyOtpInput {
  phone: string;
  role: Role;
  code: string;
  userAgent?: string | null;
  ip?: string | null;
  // Optional signup fields — only used when this verify creates a new user.
  name?: string;
  email?: string;
}

export interface VerifyOtpResult {
  sessionToken: string;
  user: UserDto;
  isNewUser: boolean;
}

export interface MeResult {
  user: UserDto;
}

function toPrismaRole(role: Role): UserRole {
  return role === "passenger" ? UserRole.passenger : UserRole.driver;
}

/**
 * Send an OTP code to the supplied phone for the supplied role.
 * - Normalizes the phone to E.164.
 * - Generates a 6-digit code, stores its SHA-256(code + pepper) in Redis at otp:{role}:{phone}.
 * - Logs the code in non-production for dev visibility.
 */
export async function sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
  const phone = normalizePhone(input.phone);
  const role = input.role;
  const code = generateOtpCode();
  const redis = getRedis();
  await storeOtp(redis, role, phone, code);

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, role, code }, "Dev OTP issued");
  }

  // Dispatch via the configured SMS provider. We do NOT fail the API call if
  // SMS delivery fails — log it and let the caller retry. The OTP is already
  // stored, so a successful subsequent send wouldn't invalidate it.
  const sms = getSmsProvider();
  const result = await sms
    .send({
      to: phone,
      body: `Your Songa code is ${code}. It expires in 5 minutes. Do not share it.`,
    })
    .catch((err: unknown) => {
      logger.error({ err, phone }, "SMS send threw");
      return { ok: false, provider: sms.name, error: String(err) } as const;
    });
  if (!result.ok) {
    logger.warn({ phone, provider: result.provider, error: result.error }, "OTP SMS delivery failed");
  }

  return {
    ok: true,
    expiresInSeconds: OTP_TTL_SECONDS,
    devCode: process.env.NODE_ENV !== "production" ? code : undefined,
    phone,
  };
}

/**
 * Verify an OTP for the phone+role, then issue a session JWT and Session row.
 * - One-shot: consumes the Redis OTP key on success.
 * - Logs OtpAttempt rows for both success and failure.
 * - Get-or-creates the User; if role is driver, also gets-or-creates a DriverProfile.
 */
export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const phone = normalizePhone(input.phone);
  const role = input.role;
  const code = input.code;
  const redis = getRedis();

  const ok = await consumeOtp(redis, role, phone, code);
  if (!ok) {
    await prisma.otpAttempt
      .create({ data: { phone, ip: input.ip ?? null, success: false } })
      .catch(() => {
        /* swallow — analytics log */
      });
    throw new AppError("INVALID_OTP", 401, "OTP is invalid or expired.");
  }

  // Get-or-create user by (phone, role). Apply optional signup fields ONLY on
  // first create — never overwrite existing users from this endpoint.
  const existing = await prisma.user.findUnique({
    where: { phone_role: { phone, role: toPrismaRole(role) } },
    include: { driverProfile: true },
  });
  const isNewUser = !existing;
  const user = existing
    ? existing
    : await prisma.user.create({
        data: {
          id: `usr_${cuid()}`,
          phone,
          role: toPrismaRole(role),
          name: input.name ?? null,
          email: input.email ?? null,
        },
        include: { driverProfile: true },
      });

  // Ensure driver profile exists for driver role (Stage 1 short-circuit: approved)
  let driverProfile = user.driverProfile ?? null;
  if (role === "driver" && !driverProfile) {
    driverProfile = await prisma.driverProfile.create({
      data: {
        userId: user.id,
        onboardingStatus: OnboardingStatus.approved,
      },
    });
  }

  // Create session row + JWT
  const sessionId = `sess_${cuid()}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const token = signSessionToken({ userId: user.id, role, sessionId });
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      expiresAt,
    },
  });

  // Audit success
  await prisma.otpAttempt
    .create({ data: { phone, ip: input.ip ?? null, success: true } })
    .catch(() => {
      /* swallow — analytics log */
    });

  return {
    sessionToken: token,
    user: toUserDto(user, driverProfile),
    isNewUser,
  };
}

/**
 * Mark the current session as revoked.
 */
export async function logout(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

/**
 * Fetch the §2.4 view of the authenticated user.
 */
export async function getMe(userId: string): Promise<MeResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { driverProfile: true },
  });
  if (!user) {
    throw new AppError("UNAUTHORIZED", 401, "User not found.");
  }
  return { user: toUserDto(user, user.driverProfile) };
}

const BROWSER_UA_RE = /Mozilla\/|Chrome\/|Safari\/|Firefox\/|Edge\//;

export function isWebClient(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return BROWSER_UA_RE.test(userAgent);
}
