/**
 * Shared SGR bookings: no per-seat / per-booking platform fee.
 * Songa charges van drivers a flat daily subscription (amount TBD, e.g. ~150 KES/day) — see backlog.
 * On-demand rides still use `PLATFORM_FEE_KES` in ride-pricing.ts.
 */
export const SHARED_SGR_PLATFORM_FEE_KES = 0;

/** % of seat subtotal withheld from driver wallet credit — not used for shared product today; optional future knob. */
export function sharedRidesDriverHoldbackPercent(): number {
  const raw = process.env.SHARED_RIDES_DRIVER_HOLDBACK_PERCENT;
  if (!raw?.trim()) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 0;
  return n;
}
