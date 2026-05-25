import { describe, expect, it } from "vitest";
import { decodeEncodedPolyline, getDrivingRoute } from "../src/lib/routing.js";

describe("routing", () => {
  it("decodes a Google encoded polyline", () => {
    const points = decodeEncodedPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points.length).toBeGreaterThan(1);
    expect(points[0]).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
  });

  it("returns an estimated route when no Google API key is set", async () => {
    const origin = { lat: -1.3192, lng: 36.9278 };
    const destination = { lat: -1.2674, lng: 36.807 };
    const plan = await getDrivingRoute(origin, destination);
    expect(plan.provider).toBe("estimate");
    expect(plan.distanceKm).toBeGreaterThan(0);
    expect(plan.durationInTrafficMinutes).toBeGreaterThanOrEqual(1);
    expect(plan.polyline.length).toBeGreaterThanOrEqual(2);
  });
});
