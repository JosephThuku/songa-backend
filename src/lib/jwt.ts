// NEW — JWT sign / verify.

import { createHash } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { Role } from "./auth-role.js";
import { loadEnv } from "../config/env.js";

const ALGORITHM = "HS256" as const;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionTokenPayload extends JwtPayload {
  sub: string; // userId
  role: Role;
  sid: string; // sessionId
}

function secret(): string {
  return loadEnv().SESSION_JWT_SECRET;
}

export function signSessionToken(payload: {
  userId: string;
  role: Role;
  sessionId: string;
}): string {
  return jwt.sign(
    { sub: payload.userId, role: payload.role, sid: payload.sessionId },
    secret(),
    { algorithm: ALGORITHM, expiresIn: SESSION_TTL_SECONDS },
  );
}

export function verifySessionToken(token: string): SessionTokenPayload {
  const decoded = jwt.verify(token, secret(), { algorithms: [ALGORITHM] });
  if (typeof decoded === "string") {
    throw new Error("Unexpected JWT payload shape");
  }
  return decoded as unknown as SessionTokenPayload;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
