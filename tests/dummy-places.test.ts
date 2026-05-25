import { describe, expect, it } from "vitest";

import {
  getDummyPlaceById,
  inferCatalogCityFromCoords,
  placeFromGpsId,
  searchDummyPlaces,
  shouldUseDummyPlaces,
} from "../src/lib/dummy-places.js";

describe("dummy places", () => {
  it("scopes autocomplete to Nairobi when origin is in Nairobi", () => {
    const results = searchDummyPlaces({
      query: "mall",
      origin: { latitude: -1.29, longitude: 36.82 },
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.placeId.startsWith("dummy_nairobi"))).toBe(
      true,
    );
  });

  it("allows Mombasa when query mentions coast", () => {
    const results = searchDummyPlaces({
      query: "nyali",
      origin: { latitude: -1.29, longitude: 36.82 },
    });
    expect(results[0]?.placeId).toBe("dummy_mombasa_nyali");
  });

  it("infers catalog city from coordinates", () => {
    expect(inferCatalogCityFromCoords(-1.3192, 36.9278)).toBe("nairobi");
    expect(inferCatalogCityFromCoords(-4.0435, 39.7189)).toBe("mombasa");
  });

  it("finds Nairobi airport and neighbourhood by query", () => {
    const jkia = searchDummyPlaces({ query: "jkia" });
    expect(jkia[0]?.placeId).toBe("dummy_nairobi_jkia_t1a");

    const westlands = searchDummyPlaces({ query: "westlands" });
    expect(westlands.some((p) => p.placeId === "dummy_nairobi_westlands")).toBe(
      true,
    );
  });

  it("finds Mombasa coast locations", () => {
    const nyali = searchDummyPlaces({ query: "nyali" });
    expect(nyali[0]?.placeId).toBe("dummy_mombasa_nyali");

    const diani = searchDummyPlaces({ query: "diani" });
    expect(diani[0]?.placeId).toBe("dummy_mombasa_diani");
  });

  it("resolves gps place ids near JKIA", () => {
    const place = placeFromGpsId("gps_-1.31920_36.92780");
    expect(place?.name).toContain("JKIA");
  });

  it("does not label far-away gps as JKIA", () => {
    const place = placeFromGpsId("gps_40.71280_-74.00600");
    expect(place?.name).toBe("Current location");
  });

  it("returns coordinates for place details", () => {
    const place = getDummyPlaceById("dummy_nairobi_jkia_t1a");
    expect(place.latitude).toBeCloseTo(-1.3192, 3);
    expect(place.longitude).toBeCloseTo(36.9278, 3);
    expect(place.name).toContain("JKIA");
  });

  it("uses Google Places by default when a key is configured", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
    const previousUseDummy = process.env.USE_DUMMY_PLACES;
    const previousUseGoogle = process.env.USE_GOOGLE_PLACES;
    try {
      process.env.NODE_ENV = "development";
      process.env.GOOGLE_PLACES_API_KEY = "test-key";
      delete process.env.USE_DUMMY_PLACES;
      delete process.env.USE_GOOGLE_PLACES;

      expect(shouldUseDummyPlaces()).toBe(false);

      process.env.USE_DUMMY_PLACES = "true";
      expect(shouldUseDummyPlaces()).toBe(true);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousGoogleKey === undefined)
        delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = previousGoogleKey;
      if (previousUseDummy === undefined) delete process.env.USE_DUMMY_PLACES;
      else process.env.USE_DUMMY_PLACES = previousUseDummy;
      if (previousUseGoogle === undefined) delete process.env.USE_GOOGLE_PLACES;
      else process.env.USE_GOOGLE_PLACES = previousUseGoogle;
    }
  });
});
