import { getNairobiParts } from "./nairobi-time.js";

const SAME_DAY_HOLD_HOURS = 24;
const FUTURE_DAY_HOLD_HOURS = 72;
/** Do not hold seats past this long before van departure. */
const BUFFER_BEFORE_DEPARTURE_MS = 60 * 60_000;

function ymd(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/**
 * Call-in / driver-invite seat hold (not the 5-minute app checkout hold).
 * 24h if van leaves today (Nairobi); 72h if departure is a later calendar day.
 * Always capped at one hour before `departureAt`.
 */
export function callInHoldExpiresAt(departureAt: Date, now: Date = new Date()): Date {
  const depParts = getNairobiParts(departureAt);
  const nowParts = getNairobiParts(now);
  const isFutureCalendarDay = ymd(depParts) > ymd(nowParts);

  const holdHours = isFutureCalendarDay ? FUTURE_DAY_HOLD_HOURS : SAME_DAY_HOLD_HOURS;
  let expires = new Date(now.getTime() + holdHours * 60 * 60_000);

  const latest = new Date(departureAt.getTime() - BUFFER_BEFORE_DEPARTURE_MS);
  if (expires.getTime() > latest.getTime()) {
    expires = latest;
  }

  const minHold = new Date(now.getTime() + 30 * 60_000);
  if (expires.getTime() < minHold.getTime() && departureAt.getTime() > now.getTime()) {
    expires = minHold.getTime() > latest.getTime() ? latest : minHold;
  }

  if (expires.getTime() <= now.getTime()) {
    expires = latest.getTime() > now.getTime() ? latest : new Date(now.getTime() + 30 * 60_000);
  }

  return expires;
}

export function callInHoldExpiresInSeconds(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(60, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}
