// NEW — requireAuth middleware.

import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { hashToken, verifySessionToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

const COOKIE_NAME = "songa_session";

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  // cookie-parser populates req.cookies
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[COOKIE_NAME] === "string" && cookies[COOKIE_NAME].length > 0) {
    return cookies[COOKIE_NAME];
  }
  return null;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    }

    let payload;
    try {
      payload = verifySessionToken(token);
    } catch {
      throw new AppError("UNAUTHORIZED", 401, "Invalid or expired session.");
    }

    const tokenHash = hashToken(token);
    const session = await prisma.session.findUnique({ where: { tokenHash } });
    if (!session) {
      throw new AppError("UNAUTHORIZED", 401, "Session not found.");
    }
    if (session.revokedAt) {
      throw new AppError("UNAUTHORIZED", 401, "Session revoked.");
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new AppError("UNAUTHORIZED", 401, "Session expired.");
    }

    const role = payload.role;
    if (role !== "passenger" && role !== "driver") {
      throw new AppError("UNAUTHORIZED", 401, "Invalid session role.");
    }

    req.user = {
      id: String(payload.sub),
      role,
      sessionId: session.id,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
