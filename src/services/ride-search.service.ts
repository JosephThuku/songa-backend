import { AppError } from "../lib/errors.js";
import { haversineDistanceKm, MIN_TRIP_DISTANCE } from "../lib/geo.js";
import { getBookingMode } from "../lib/ride-booking-mode.js";
import { computeFare } from "../lib/ride-pricing.js";
import { RIDE_PRODUCTS } from "../lib/ride-products.js";
import { findDriversNearPickup } from "./driver.service.js";
import type { PlaceDto } from "../lib/responses.js";

export interface SearchRideInput {
  pickup: PlaceDto;
  dropoff: PlaceDto;
}

export interface RideSearchOption {
  optionId: string;
  vehicleType: string;
  label: string;
  capacity: number;
  available: boolean;
  pickupEtaMinutes: number | null;
  priceAmount: number | null;
  currency: "KES";
}

export interface SearchRideResponse {
  pickup: PlaceDto;
  dropoff: PlaceDto;
  tripDurationMinutes: number;
  bookingMode: "seat_selection" | "pay_on_arrival";
  requiresSeats: boolean;
  options: RideSearchOption[];
}

export async function searchRides(input: SearchRideInput): Promise<SearchRideResponse> {
  const distanceKm = haversineDistanceKm(input.pickup, input.dropoff);
  if (distanceKm < MIN_TRIP_DISTANCE) {
    throw new AppError("INVALID_INPUT", 400, "Pickup and dropoff must be different locations.");
  }

  const fare = computeFare(input.pickup, input.dropoff);
  const bookingMode = getBookingMode(input.pickup.label, input.dropoff.label);
  const requiresSeats = bookingMode === "seat_selection";

  const options: RideSearchOption[] = await Promise.all(
    RIDE_PRODUCTS.map(async (product) => {
      const nearbyDrivers = await findDriversNearPickup({
        pickup: input.pickup,
        vehicleType: product.vehicleType,
        limit: 1,
      });
      const nearest = nearbyDrivers[0];
      return {
        optionId: product.optionId,
        vehicleType: product.vehicleType,
        label: product.label,
        capacity: product.capacity,
        available: nearbyDrivers.length > 0,
        pickupEtaMinutes: nearest ? nearest.pickupEtaMinutes : null,
        priceAmount: Math.round(fare.total * product.priceMultiplier),
        currency: "KES" as const,
      };
    }),
  );

  return {
    pickup: input.pickup,
    dropoff: input.dropoff,
    tripDurationMinutes: fare.durationMinutes,
    bookingMode,
    requiresSeats,
    options,
  };
}
