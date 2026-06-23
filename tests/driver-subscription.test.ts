import { afterEach, describe, expect, it } from "vitest";

import { driverDailySubscriptionKes } from "../src/config/driver-subscription.js";

describe("driverDailySubscriptionKes", () => {
  const savedGlobal = process.env.DRIVER_DAILY_SUBSCRIPTION_KES;
  const savedByType = process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE;

  afterEach(() => {
    if (savedGlobal) process.env.DRIVER_DAILY_SUBSCRIPTION_KES = savedGlobal;
    else delete process.env.DRIVER_DAILY_SUBSCRIPTION_KES;
    if (savedByType) process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE = savedByType;
    else delete process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE;
  });

  it("uses vehicle-type overrides when configured", () => {
    delete process.env.DRIVER_DAILY_SUBSCRIPTION_KES;
    process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE = JSON.stringify({ Car: 200, Van: 175 });
    expect(driverDailySubscriptionKes("Car")).toBe(200);
    expect(driverDailySubscriptionKes("Van")).toBe(175);
  });

  it("falls back to defaults by vehicle type", () => {
    delete process.env.DRIVER_DAILY_SUBSCRIPTION_KES;
    delete process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE;
    expect(driverDailySubscriptionKes("Minibus")).toBe(200);
    expect(driverDailySubscriptionKes("Bike")).toBe(100);
  });
});
