import { describe, expect, it } from "vitest";

import { driverLocationFreshWindowMs } from "../src/lib/driver-location-freshness.js";

describe("driverLocationFreshWindowMs", () => {
  it("uses 60s in test environment", () => {
    expect(driverLocationFreshWindowMs()).toBe(60_000);
  });

  it("uses 24h when NODE_ENV is unset (local dev)", () => {
    const prev = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    expect(driverLocationFreshWindowMs()).toBe(24 * 60 * 60 * 1000);
    process.env.NODE_ENV = prev;
  });
});
