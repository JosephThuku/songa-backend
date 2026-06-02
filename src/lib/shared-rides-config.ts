function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const sharedRidesConfig = {
  timezone: "Africa/Nairobi",
  bookingLeadMinutes: envInt("SHARED_RIDES_BOOKING_LEAD_MIN", 120),
  fromSgrGraceMinutes: envInt("SHARED_RIDES_FROM_SGR_GRACE_MIN", 45),
  fromSgrLookaheadHours: envInt("SHARED_RIDES_FROM_SGR_LOOKAHEAD_H", 6),
  maxSuggestions: envInt("SHARED_RIDES_MAX_SUGGESTIONS", 2),
  /** Hold on reserved seats before payment (minutes). */
  seatReserveMinutes: envInt("SHARED_RIDES_SEAT_RESERVE_MIN", 15),
} as const;
