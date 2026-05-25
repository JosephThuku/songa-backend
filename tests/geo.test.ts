import { describe, expect, it } from "vitest";
import {
  haversineDistanceKm,
  estimatePickupEtaMinutes,
  estimateDrivingMinutes,
  MIN_TRIP_DISTANCE,
  DRIVER_ARRIVING_KM,
  type LatLng,
} from "../src/lib/geo.js";

describe("haversineDistanceKm", () => {
  it("returns 0 for the same point", () => {
    const p: LatLng = { lat: -1.2674, lng: 36.807 };
    expect(haversineDistanceKm(p, p)).toBe(0);
  });

  it("returns ~111.2 km for 1 degree of longitude on the equator", () => {
    const a: LatLng = { lat: 0, lng: 0 };
    const b: LatLng = { lat: 0, lng: 1 };
    const dist = haversineDistanceKm(a, b);
    expect(dist).toBeGreaterThan(111.0);
    expect(dist).toBeLessThan(111.4);
  });

  it("returns ~14–16 km between Westlands and JKIA (Nairobi)", () => {
    const westlands: LatLng = { lat: -1.2674, lng: 36.807 };
    const jkia: LatLng = { lat: -1.3192, lng: 36.9278 };
    const dist = haversineDistanceKm(westlands, jkia);
    expect(dist).toBeGreaterThan(13);
    expect(dist).toBeLessThan(16);
  });

  it("is symmetric — dist(A, B) === dist(B, A)", () => {
    const a: LatLng = { lat: -1.2674, lng: 36.807 };
    const b: LatLng = { lat: -1.3192, lng: 36.9278 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 6);
  });

  it("is non-negative for any two points", () => {
    const pairs: [LatLng, LatLng][] = [
      [{ lat: 0, lng: 0 }, { lat: 90, lng: 180 }],
      [{ lat: -45, lng: -90 }, { lat: 45, lng: 90 }],
      [{ lat: -1.2833, lng: 36.8167 }, { lat: -1.3192, lng: 36.9278 }],
    ];
    for (const [a, b] of pairs) {
      expect(haversineDistanceKm(a, b)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("estimatePickupEtaMinutes", () => {
  it("returns at least 1 minute for 0 km", () => {
    expect(estimatePickupEtaMinutes(0)).toBe(1);
  });

  it("returns 1 for very short distances (< 0.5 km)", () => {
    expect(estimatePickupEtaMinutes(0.1)).toBe(1);
    expect(estimatePickupEtaMinutes(0.44)).toBe(1);
  });

  it("returns ~22 minutes for 10 km (10 / 0.45 ≈ 22)", () => {
    expect(estimatePickupEtaMinutes(10)).toBe(22);
  });

  it("increases monotonically with distance", () => {
    const distances = [0.5, 1, 2, 5, 10, 20];
    const etas = distances.map(estimatePickupEtaMinutes);
    for (let i = 1; i < etas.length; i++) {
      expect(etas[i]).toBeGreaterThanOrEqual(etas[i - 1]!);
    }
  });
});

describe("estimateDrivingMinutes", () => {
  it("returns at least 1 minute for 0 km", () => {
    expect(estimateDrivingMinutes(0)).toBe(1);
  });

  it("returns 1 for distances under 0.5 km", () => {
    expect(estimateDrivingMinutes(0.1)).toBe(1);
    expect(estimateDrivingMinutes(0.49)).toBe(1);
  });

  it("returns ~20 minutes for 10 km (10 / 0.5 = 20)", () => {
    expect(estimateDrivingMinutes(10)).toBe(20);
  });

  it("returns ~30 minutes for 15 km (15 / 0.5 = 30)", () => {
    expect(estimateDrivingMinutes(15)).toBe(30);
  });

  it("increases monotonically with distance", () => {
    const distances = [0.5, 1, 2, 5, 10, 20];
    const durations = distances.map(estimateDrivingMinutes);
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeGreaterThanOrEqual(durations[i - 1]!);
    }
  });
});

describe("constants", () => {
  it("MIN_TRIP_DISTANCE is a positive number", () => {
    expect(typeof MIN_TRIP_DISTANCE).toBe("number");
    expect(MIN_TRIP_DISTANCE).toBeGreaterThan(0);
  });

  it("DRIVER_ARRIVING_KM is the arriving-radius threshold (2 km)", () => {
    expect(typeof DRIVER_ARRIVING_KM).toBe("number");
    expect(DRIVER_ARRIVING_KM).toBe(2);
  });

  it("DRIVER_ARRIVING_KM is greater than MIN_TRIP_DISTANCE", () => {
    expect(DRIVER_ARRIVING_KM).toBeGreaterThan(MIN_TRIP_DISTANCE);
  });
});
