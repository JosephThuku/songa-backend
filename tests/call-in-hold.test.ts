import { describe, expect, it } from "vitest";
import { CALL_IN_HOLD_MINUTES, callInHoldExpiresAt } from "../src/lib/call-in-hold.js";

describe("callInHoldExpiresAt", () => {
  it(`defaults to ${CALL_IN_HOLD_MINUTES} minutes when departure is far away`, () => {
    const now = new Date("2026-06-02T08:00:00+03:00");
    const departure = new Date("2026-06-05T08:00:00+03:00");
    const expires = callInHoldExpiresAt(departure, now);
    const minutes = (expires.getTime() - now.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(CALL_IN_HOLD_MINUTES, 0);
  });

  it("shortens hold when departure is within the pre-departure buffer", () => {
    const now = new Date("2026-06-02T08:00:00+03:00");
    const departure = new Date("2026-06-02T08:30:00+03:00");
    const expires = callInHoldExpiresAt(departure, now);
    const minutes = (expires.getTime() - now.getTime()) / 60_000;
    expect(minutes).toBeLessThanOrEqual(2);
    expect(minutes).toBeGreaterThan(0);
  });
});
