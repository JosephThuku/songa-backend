import { describe, expect, it } from "vitest";
import { sharedBookingPlaceInputs } from "../src/lib/shared-booking-places.js";

describe("sharedBookingPlaceInputs", () => {
  const departure = {
    pickupLocationId: "zone-nyali",
    dropoffLocationId: "sgr-miritini-id",
    pickupLocation: { id: "zone-nyali", slug: "nyali" },
    dropoffLocation: { id: "sgr-miritini-id", slug: "sgr-miritini" },
  };

  it("tags neighborhood pickup and SGR dropoff for to_sgr trips", () => {
    const result = sharedBookingPlaceInputs(
      departure,
      { label: "Pin", lat: 1, lng: 2 },
      { label: "SGR", lat: 3, lng: 4 },
      true,
    );
    expect(result.pickup.corridorLocationId).toBe("zone-nyali");
    expect(result.dropoff.corridorLocationId).toBe("sgr-miritini-id");
  });

  it("tags SGR pickup and neighborhood dropoff for from_sgr trips", () => {
    const fromDeparture = {
      pickupLocationId: "sgr-miritini-id",
      dropoffLocationId: "zone-nyali",
      pickupLocation: { id: "sgr-miritini-id", slug: "sgr-miritini" },
      dropoffLocation: { id: "zone-nyali", slug: "nyali" },
    };
    const result = sharedBookingPlaceInputs(
      fromDeparture,
      { label: "SGR", lat: 3, lng: 4 },
      { label: "Pin", lat: 1, lng: 2 },
      false,
    );
    expect(result.pickup.corridorLocationId).toBe("sgr-miritini-id");
    expect(result.dropoff.corridorLocationId).toBe("zone-nyali");
  });
});
