// Auth: register → confirm OTP → login (phone/email + password).

import cuid from "cuid";
import { OnboardingStatus, Prisma, UserRole, type DriverProfile, type User, type Vehicle } from "@prisma/client";
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
  userAgent?: string | null;
}

export interface ConfirmRegistrationResult {
  ok: true;
  user: UserDto;
  sessionToken: string;
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

export interface ForgotPasswordInput {
  phone: string;
  role: Role;
}

export interface ForgotPasswordResult {
  ok: true;
  expiresInSeconds: number;
  devCode?: string;
  phone: string;
}

export interface ResetPasswordInput {
  phone: string;
  role: Role;
  code: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}

export interface ResetPasswordResult {
  ok: true;
  user: UserDto;
  sessionToken: string;
}

function toPrismaRole(role: Role): UserRole {
  return role === "passenger" ? UserRole.passenger : UserRole.driver;
}

async function issueOtp(
  role: Role,
  phone: string,
  purpose: "register" | "password_reset" = "register",
): Promise<{ code: string }> {
  const code = generateOtpCode();
  const redis = getRedis();
  await storeOtp(redis, purpose, role, phone, code);

  if (process.env.NODE_ENV !== "production") {
    logger.info({ phone, role, code, purpose }, `Dev OTP issued (${purpose})`);
  }

  const body =
    purpose === "password_reset"
      ? `Your Songa password reset code is ${code}. It expires in 5 minutes. Do not share it.`
      : `Your Songa code is ${code}. It expires in 5 minutes. Do not share it.`;
  const sms = getSmsProvider();
  const result = await sms
    .send({ to: phone, body, isOtp: true })
    .catch((err: unknown) => {
      logger.error({ err, phone }, "SMS send threw");
      return { ok: false, provider: sms.name, error: String(err) } as const;
    });
  if (!result.ok) {
    logger.warn({ phone, provider: result.provider, error: result.error }, "OTP SMS delivery failed");
  }

  return { code };
}

async function createSession(
  tx: Prisma.TransactionClient,
  user: User & { driverProfile: DriverProfile | null },
  role: Role,
  userAgent?: string | null,
  ip?: string | null,
): Promise<string> {
  const sessionId = `sess_${cuid()}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const token = signSessionToken({ userId: user.id, role, sessionId });
  await tx.session.create({
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

async function ensureDriverProfileTx(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<DriverProfile & { vehicle: Vehicle | null }> {
  const existing = await tx.driverProfile.findUnique({
    where: { userId },
    include: { vehicle: true },
  });
  if (existing) return existing;
  return tx.driverProfile.create({
    data: {
      userId,
      onboardingStatus: OnboardingStatus.approved,
    },
    include: { vehicle: true },
  });
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
 * Confirm registration OTP, create the user, and start a 30-day session.
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
  let sessionToken = "";
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

    const withProfile =
      role === "driver"
        ? { ...created, driverProfile: driverProfile! }
        : { ...created, driverProfile: null as DriverProfile | null };

    sessionToken = await createSession(
      tx,
      withProfile,
      role,
      input.userAgent,
      input.ip,
    );

    return created;
  });

  await prisma.otpAttempt
    .create({ data: { phone, ip: input.ip ?? null, success: true } })
    .catch(() => {});

  return { ok: true, user: toUserDto(user, driverProfile), sessionToken };
}

/**
 * Sign in with phone or email plus password.
 */
function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("retry transaction") ||
    msg.includes("Table definition has changed") ||
    msg.includes("Deadlock found") ||
    msg.includes("write conflict")
  );
}

async function loginWithTransaction(input: LoginInput): Promise<LoginResult> {
  const identifier = normalizeLoginIdentifier(input.identifier);
  const role = input.role;

  return prisma.$transaction(async (tx) => {
    const user = isEmailIdentifier(identifier)
      ? await tx.user.findFirst({
          where: { email: identifier, role: toPrismaRole(role) },
          include: { driverProfile: { include: { vehicle: true } } },
        })
      : await tx.user.findUnique({
          where: { phone_role: { phone: identifier, role: toPrismaRole(role) } },
          include: { driverProfile: { include: { vehicle: true } } },
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
      driverProfile = await ensureDriverProfileTx(tx, user.id);
    }

    const sessionToken = await createSession(tx, user, role, input.userAgent, input.ip);

    return {
      sessionToken,
      user: toUserDto(user, driverProfile),
    };
  });
}

export async function login(input: LoginInput): Promise<LoginResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await loginWithTransaction(input);
    } catch (err) {
      lastError = err;
      if (err instanceof AppError) throw err;
      if (!isTransientDbError(err) || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 75 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function logout(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
}

/**
 * Send a password-reset OTP to a verified account's phone.
 * Always returns success to avoid leaking whether the account exists.
 */
export async function forgotPassword(input: ForgotPasswordInput): Promise<ForgotPasswordResult> {
  const phone = normalizePhone(input.phone);
  const role = input.role;

  const user = await prisma.user.findUnique({
    where: { phone_role: { phone, role: toPrismaRole(role) } },
  });

  let devCode: string | undefined;
  if (user?.phoneVerified && user.passwordHash) {
    const { code } = await issueOtp(role, phone, "password_reset");
    devCode = process.env.NODE_ENV !== "production" ? code : undefined;
  } else {
    logger.info({ phone, role }, "Password reset requested for unknown or incomplete account");
  }

  return {
    ok: true,
    expiresInSeconds: OTP_TTL_SECONDS,
    devCode,
    phone,
  };
}

/**
 * Verify password-reset OTP, set a new password, revoke old sessions, and sign in.
 */
export async function resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResult> {
  const phone = normalizePhone(input.phone);
  const role = input.role;
  const redis = getRedis();

  const ok = await consumeOtp(redis, "password_reset", role, phone, input.code);
  if (!ok) {
    await prisma.otpAttempt
      .create({ data: { phone, ip: input.ip ?? null, success: false } })
      .catch(() => {});
    throw new AppError("INVALID_OTP", 401, "OTP is invalid or expired.");
  }

  const passwordHash = await hashPassword(input.password);

  let driverProfile: DriverProfile | null = null;
  let sessionToken = "";
  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { phone_role: { phone, role: toPrismaRole(role) } },
      include: { driverProfile: { include: { vehicle: true } } },
    });
    if (!existing?.phoneVerified || !existing.passwordHash) {
      throw new AppError("INVALID_OTP", 401, "OTP is invalid or expired.");
    }

    const updated = await tx.user.update({
      where: { id: existing.id },
      data: { passwordHash },
    });

    await tx.session.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    driverProfile = existing.driverProfile;
    if (role === "driver" && !driverProfile) {
      driverProfile = await ensureDriverProfileTx(tx, existing.id);
    }

    const withProfile =
      role === "driver"
        ? { ...updated, driverProfile: driverProfile! }
        : { ...updated, driverProfile: null as DriverProfile | null };

    sessionToken = await createSession(
      tx,
      withProfile,
      role,
      input.userAgent,
      input.ip,
    );

    return updated;
  });

  await prisma.otpAttempt
    .create({ data: { phone, ip: input.ip ?? null, success: true } })
    .catch(() => {});

  return { ok: true, user: toUserDto(user, driverProfile), sessionToken };
}

export async function getMe(userId: string): Promise<MeResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { driverProfile: { include: { vehicle: true } } },
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
