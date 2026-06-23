/**
 * Shared SGR bookings: no per-seat / per-booking platform fee.
 * Songa charges van drivers a flat daily subscription (amount TBD, e.g. ~150 KES/day) — see backlog.
 * On-demand rides still use `PLATFORM_FEE_KES` in ride-pricing.ts.
 */
export const SHARED_SGR_PLATFORM_FEE_KES = 0;

/** Unpaid shared SGR bookings are auto-cancelled after this many minutes. */
export const SHARED_SGR_UNPAID_BOOKING_MINUTES = 25;

/** % of seat subtotal withheld from driver wallet credit — not used for shared product today; optional future knob. */
export function sharedRidesDriverHoldbackPercent(): number {
  const raw = process.env.SHARED_RIDES_DRIVER_HOLDBACK_PERCENT;
  if (!raw?.trim()) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 0;
  return n;
}

const DEFAULT_MIN_BOOKABLE_SEATS = 1;

/** Minimum bookable seats after layout (publish / join). Default 1 — any car/van/minibus may publish. */
export function sharedRidesMinBookableSeats(): number {
  const raw = process.env.SHARED_RIDES_MIN_BOOKABLE_SEATS;
  if (!raw?.trim()) return DEFAULT_MIN_BOOKABLE_SEATS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MIN_BOOKABLE_SEATS;
  return n;
}

/** Allowed `Vehicle.type` values for shared SGR. Default: any type. Set e.g. `Van,Minibus` to restrict. */
export function sharedRidesAllowedVehicleTypes(): string[] | null {
  const raw = process.env.SHARED_RIDES_ALLOWED_VEHICLE_TYPES?.trim();
  if (!raw) return null;
  if (raw === "*" || raw.toLowerCase() === "any") return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
