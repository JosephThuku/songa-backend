import { describe, expect, it } from "vitest";
import { callInHoldExpiresAt } from "../src/lib/call-in-hold.js";

describe("callInHoldExpiresAt", () => {
  it("caps at one hour before departure when the van leaves soon", () => {
    const now = new Date("2026-06-02T08:00:00+03:00");
    const departure = new Date("2026-06-02T18:00:00+03:00");
    const expires = callInHoldExpiresAt(departure, now);
    const hours = (expires.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(10);
    expect(hours).toBeGreaterThan(8);
  });

  it("allows up to 24h on the same Nairobi calendar day when time allows", () => {
    const now = new Date("2026-06-02T06:00:00+03:00");
    const departure = new Date("2026-06-02T23:00:00+03:00");
    const expires = callInHoldExpiresAt(departure, now);
    const hours = (expires.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThanOrEqual(16);
    expect(hours).toBeLessThanOrEqual(24.1);
  });

  it("allows up to 72h when departure is on a later calendar day", () => {
    const now = new Date("2026-06-02T08:00:00+03:00");
    const departure = new Date("2026-06-05T08:00:00+03:00");
    const expires = callInHoldExpiresAt(departure, now);
    const hours = (expires.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(48);
    expect(hours).toBeLessThanOrEqual(72.1);
  });
});
