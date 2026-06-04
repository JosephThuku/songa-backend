import { getNairobiParts } from "./nairobi-time.js";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Minutes a call-in seat stays reserved until the passenger pays (driver prompt flow). */
export const CALL_IN_HOLD_MINUTES = envInt("CALL_IN_HOLD_MINUTES", 10);

/** Do not hold seats past this long before van departure. */
const BUFFER_BEFORE_DEPARTURE_MS = 60 * 60_000;

function ymd(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/**
 * Call-in seat hold: short window for the passenger to pay via link (default 10 minutes).
 * Capped at one hour before `departureAt`.
 */
export function callInHoldExpiresAt(departureAt: Date, now: Date = new Date()): Date {
  let expires = new Date(now.getTime() + CALL_IN_HOLD_MINUTES * 60_000);

  const latest = new Date(departureAt.getTime() - BUFFER_BEFORE_DEPARTURE_MS);
  if (expires.getTime() > latest.getTime()) {
    expires = latest;
  }

  if (expires.getTime() <= now.getTime()) {
    expires = latest.getTime() > now.getTime() ? latest : new Date(now.getTime() + 60_000);
  }

  return expires;
}

export function callInHoldExpiresInSeconds(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(60, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}
