// Auth: register → confirm OTP → login (phone/email + password).

import cuid from "cuid";
import { OnboardingStatus, UserRole, type DriverProfile, type User } from "@prisma/client";
import type { Role } from "../lib/auth-role.js";
import { AppError } from "../lib/errors.js";
import { isEmailIdentifier, normalizeEmail, normalizeLoginIdentifier } from "../lib/identifier.js";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../lib/password.js";
import {
  consumePendingRegistration,
  storePendingRegistration,
} from "../lib/pending-registration.js";
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

export type { Role };

export interface RegisterInput {
  phone: string;
  role: Role;
  password: string;
  name?: string;
  email?: string;
}

export interface RegisterResult {
  ok: true;
  expiresInSeconds: number;
  devCode?: string;
  phone: string;
}

export interface ConfirmRegistrationInput {
  phone: string;
  role: Role;
  code: string;
  ip?: string | null;
}

export interface ConfirmRegistrationResult {
  ok: true;
  user: UserDto;
}

export interface LoginInput {
  identifier: string;
  password: string;
  role: Role;
  userAgent?: string | null;
  ip?: string | null;
}

export interface LoginResult {
  sessionToken: string;
  user: UserDto;
}

export interface MeResult {
  user: UserDto;
}

function toPrismaRole(role: Role): UserRole {
  return role === "passenger" ? UserRole.passenger : UserRole.driver;
}

async function dispatchOtpSms(phone: string, code: string): Promise<void> {
  const sms = getSmsProvider();
  const result = await sms
    .send({
      to: phone,
      body: `Your Songa code is ${code}. It expires in 5 minutes. Do not share it.`,
      isOtp: true,
    })
    .catch((err: unknown) => {
      logger.error({ err, phone }, "SMS send threw");
      return { ok: false, provider: sms.name, error: String(err) } as const;
    });
  if (!result.ok) {
    logger.warn({ phone, provider: result.provider, error: result.error }, "OTP SMS delivery failed");
  }
}

async function issueOtp(role: Role, phone: string): Promise<{ code: string }> {
  const code = generateOtpCode();
  const redis = getRedis();
  await storeOtp(redis, "register", role, phone, code);

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, role, code }, "Dev OTP issued (register)");
  }

  await dispatchOtpSms(phone, code);
  return { code };
}

async function createSession(
  user: User & { driverProfile: DriverProfile | null },
  role: Role,
  userAgent?: string | null,
  ip?: string | null,
): Promise<string> {
  const sessionId = `sess_${cuid()}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const token = signSessionToken({ userId: user.id, role, sessionId });
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(token),
      userAgent: userAgent ?? null,
      ip: ip ?? null,
      expiresAt,
    },
  });
  return token;
}

async function ensureDriverProfile(userId: string): Promise<DriverProfile> {
  const existing = await prisma.driverProfile.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.driverProfile.create({
    data: {
      userId,
      onboardingStatus: OnboardingStatus.approved,
    },
  });
}

/**
 * Start registration: store pending credentials and send OTP to verify the phone.
 */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  const phone = normalizePhone(input.phone);
  const role = input.role;
  validatePasswordStrength(input.password);

  const email = input.email ? normalizeEmail(input.email) : null;

  const existing = await prisma.user.findUnique({
    where: { phone_role: { phone, role: toPrismaRole(role) } },
  });
  if (existing?.phoneVerified && existing.passwordHash) {
    throw new AppError("USER_EXISTS", 409, "An account with this phone already exists. Sign in instead.");
  }

  if (email) {
    const emailTaken = await prisma.user.findFirst({
      where: { email, role: toPrismaRole(role) },
    });
    if (emailTaken?.phoneVerified) {
      throw new AppError("EMAIL_IN_USE", 409, "This email is already registered for this role.");
    }
  }

  const passwordHash = await hashPassword(input.password);
  const redis = getRedis();
  await storePendingRegistration(redis, {
    phone,
    role,
    passwordHash,
    name: input.name?.trim() || null,
    email,
  });

  const { code } = await issueOtp(role, phone);

  return {
    ok: true,
    expiresInSeconds: OTP_TTL_SECONDS,
    devCode: process.env.NODE_ENV !== "production" ? code : undefined,
    phone,
  };
}

/**
 * Confirm registration OTP and create the user. Does not issue a session — user signs in next.
 */
export async function confirmRegistration(
  input: ConfirmRegistrationInput,
): Promise<ConfirmRegistrationResult> {
  const phone = normalizePhone(input.phone);
  const role = input.role;
  const redis = getRedis();

  const ok = await consumeOtp(redis, "register", role, phone, input.code);
  if (!ok) {
    await prisma.otpAttempt
      .create({ data: { phone, ip: input.ip ?? null, success: false } })
      .catch(() => {});
    throw new AppError("INVALID_OTP", 401, "OTP is invalid or expired.");
  }

  const pending = await consumePendingRegistration(redis, role, phone);
  if (!pending) {
    throw new AppError(
      "REGISTRATION_EXPIRED",
      400,
      "Registration expired. Please sign up again.",
    );
  }

  let driverProfile: DriverProfile | null = null;
  const user = await prisma.$transaction(async (tx) => {
    const prior = await tx.user.findUnique({
      where: { phone_role: { phone, role: toPrismaRole(role) } },
    });
    if (prior?.phoneVerified && prior.passwordHash) {
      throw new AppError("USER_EXISTS", 409, "An account with this phone already exists.");
    }

    const created = prior
      ? await tx.user.update({
          where: { id: prior.id },
          data: {
            passwordHash: pending.passwordHash,
            phoneVerified: true,
            name: pending.name ?? prior.name,
            email: pending.email ?? prior.email,
          },
        })
      : await tx.user.create({
          data: {
            id: `usr_${cuid()}`,
            phone,
            role: toPrismaRole(role),
            passwordHash: pending.passwordHash,
            phoneVerified: true,
            name: pending.name,
            email: pending.email,
          },
        });

    if (role === "driver") {
      const profile = await tx.driverProfile.findUnique({ where: { userId: created.id } });
      driverProfile =
        profile ??
        (await tx.driverProfile.create({
          data: {
            userId: created.id,
            onboardingStatus: OnboardingStatus.approved,
          },
        }));
    }

    return created;
  });

  await prisma.otpAttempt
    .create({ data: { phone, ip: input.ip ?? null, success: true } })
    .catch(() => {});

  return { ok: true, user: toUserDto(user, driverProfile) };
}

/**
 * Sign in with phone or email plus password.
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const identifier = normalizeLoginIdentifier(input.identifier);
  const role = input.role;

  const user = isEmailIdentifier(identifier)
    ? await prisma.user.findFirst({
        where: { email: identifier, role: toPrismaRole(role) },
        include: { driverProfile: true },
      })
    : await prisma.user.findUnique({
        where: { phone_role: { phone: identifier, role: toPrismaRole(role) } },
        include: { driverProfile: true },
      });

  if (!user?.phoneVerified || !user.passwordHash) {
    throw new AppError("INVALID_CREDENTIALS", 401, "Invalid phone/email or password.");
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new AppError("INVALID_CREDENTIALS", 401, "Invalid phone/email or password.");
  }

  let driverProfile = user.driverProfile;
  if (role === "driver" && !driverProfile) {
    driverProfile = await ensureDriverProfile(user.id);
  }

  const sessionToken = await createSession(user, role, input.userAgent, input.ip);

  return {
    sessionToken,
    user: toUserDto(user, driverProfile),
  };
}

export async function logout(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

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
