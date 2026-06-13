import { describe, expect, it } from "vitest";
import { driverLocationToJson } from "../src/lib/driver-location.js";
import { hasDriverDeclinedRide } from "../src/lib/ride-driver-decline.js";
import { seatNumbersFromRide, serializeRideSeats } from "../src/lib/ride-seats.js";
import { parseDeclinedBy } from "../src/lib/ride-decline.js";

describe("phase 5 integrity helpers", () => {
  it("parses legacy declinedBy JSON for backfill", () => {
    expect(parseDeclinedBy('["drv_a","drv_b"]')).toEqual(["drv_a", "drv_b"]);
    expect(parseDeclinedBy("[]")).toEqual([]);
  });

  it("detects driver decline from junction rows", () => {
    expect(hasDriverDeclinedRide({ driverDeclines: [{ driverId: "d1" }] }, "d1")).toBe(true);
    expect(hasDriverDeclinedRide({ driverDeclines: [{ driverId: "d1" }] }, "d2")).toBe(false);
  });

  it("serializes and reads ride seats from junction or legacy string", () => {
    expect(serializeRideSeats([2, 1, 2])).toBe("1,2");
    expect(seatNumbersFromRide({ seats: "3,1", seatRows: [{ seatNumber: 1 }, { seatNumber: 3 }] })).toEqual([
      1, 3,
    ]);
    expect(seatNumbersFromRide({ seats: "4,2" })).toEqual([2, 4]);
  });

  it("converts DriverLocation record to API JSON", () => {
    const at = new Date("2026-06-05T03:00:00.000Z");
    expect(
      driverLocationToJson({
        lat: -1.27,
        lng: 36.81,
        heading: 90,
        updatedAt: at,
      }),
    ).toEqual({
      lat: -1.27,
      lng: 36.81,
      heading: 90,
      updatedAt: at.toISOString(),
    });
  });
});
