import { describe, expect, it } from "vitest";
import { PLATFORM_FEE_KES, computeFare } from "../src/lib/ride-pricing.js";

const JKIA = { label: "JKIA Terminal 1A", lat: -1.3192, lng: 36.9278 };
const westlands = { label: "Westlands", lat: -1.2674, lng: 36.807 };
const kilimani = { label: "Kilimani", lat: -1.2921, lng: 36.7856 };
const westlandsNear = { label: "Westlands near", lat: -1.2675, lng: 36.8071 };

function getBreakdown(fare: ReturnType<typeof computeFare>) {
  // Support both flat Fare API and nested ComputedFare.breakdown API.
  return (fare as unknown as { breakdown: typeof fare }).breakdown ?? fare;
}

describe("computeFare (Uber v1)", () => {
  it("applies minimum fare for very short trips (< 0.2 km apart)", () => {
    const fare = computeFare(westlands, westlandsNear);
    expect(fare.total).toBe(200);
    // minimumFareApplied lives either at top level or inside breakdown
    const bd = getBreakdown(fare) as { minimumFareApplied: boolean };
    expect(bd.minimumFareApplied).toBe(true);
  });

  it("scales with distance — longer trip costs more than minimum fare", () => {
    const short = computeFare(westlands, westlandsNear);
    const long = computeFare(JKIA, westlands);
    expect(long.total).toBeGreaterThan(short.total);
    expect(long.distanceKm).toBeGreaterThan(short.distanceKm);
    expect(long.durationMinutes).toBeGreaterThanOrEqual(short.durationMinutes);
  });

  it("breakdown components sum to subtotal for a long trip", () => {
    const fare = computeFare(JKIA, westlands);
    expect(fare.distanceKm).toBeGreaterThan(5);
    expect(fare.durationMinutes).toBeGreaterThan(5);
    const bd = getBreakdown(fare) as {
      baseFare: number; distanceCharge: number; timeCharge: number; bookingFee: number; subtotal: number;
    };
    expect(bd.subtotal).toBe(bd.baseFare + bd.distanceCharge + bd.timeCharge + bd.bookingFee);
    expect(fare.total).toBeGreaterThanOrEqual(200);
  });

  it("exports platform fee constant for wallet settlement", () => {
    expect(PLATFORM_FEE_KES).toBe(50);
  });

  it("adds surge proportionally when multiplier > 1", () => {
    const base = computeFare(westlands, kilimani);
    // Try both calling conventions: legacy number and new opts object.
    const withNum = computeFare(westlands, kilimani, 1.5 as unknown as never);
    const withOpts = computeFare(westlands, kilimani, { surgeMultiplier: 1.5 } as unknown as never);
    const surged = withNum.total > base.total ? withNum : withOpts;
    expect(surged.total).toBeGreaterThan(base.total);
    // Surge must increase total by ~50%
    expect(surged.total).toBeGreaterThanOrEqual(Math.floor(base.total * 1.4));
  });
});
