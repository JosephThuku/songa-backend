import type { BookingMode } from "@prisma/client";

export const TERMINAL_PATTERNS = [
  /\bairport\b/i,
  /\bjkia\b/i,
  /\bwilson\b/i,
  /\bsgr\b/i,
  /\bterminal\b/i,
  /\bterminus\b/i,
] as const;

export function getBookingMode(pickupLabel: string, dropoffLabel: string): BookingMode {
  const text = `${pickupLabel} ${dropoffLabel}`;
  return TERMINAL_PATTERNS.some((pattern) => pattern.test(text)) ? "seat_selection" : "pay_on_arrival";
}

