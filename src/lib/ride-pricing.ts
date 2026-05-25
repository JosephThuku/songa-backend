import { estimateDrivingMinutes, haversineDistanceKm } from "./geo.js";
import type { PlaceDto } from "./responses.js";

export const PLATFORM_FEE_KES = 50;

const BASE_FARE_KES = 100;
const PER_KM_KES = 45;
const PER_MIN_KES = 5;
const BOOKING_FEE_KES = 25;
const MIN_FARE_KES = 200;

export interface Fare {
  baseFare: number;
  distanceCharge: number;
  timeCharge: number;
  bookingFee: number;
  subtotal: number;
  minimumFareApplied: boolean;
  surge: number;
  total: number;
  platformFee: number;
  distanceKm: number;
  durationMinutes: number;
  currency: "KES";
}

export function computeFare(
  pickup: PlaceDto,
  dropoff: PlaceDto,
  opts?: { surgeMultiplier?: number },
): Fare {
  const distanceKm = haversineDistanceKm(pickup, dropoff);
  const durationMinutes = estimateDrivingMinutes(distanceKm);
  const surgeMultiplier = opts?.surgeMultiplier ?? 1;

  const baseFare = BASE_FARE_KES;
  const distanceCharge = Math.round(distanceKm * PER_KM_KES);
  const timeCharge = durationMinutes * PER_MIN_KES;
  const bookingFee = BOOKING_FEE_KES;
  const rawSubtotal = baseFare + distanceCharge + timeCharge + bookingFee;
  const minimumFareApplied = rawSubtotal < MIN_FARE_KES;
  const subtotal = minimumFareApplied ? MIN_FARE_KES : rawSubtotal;
  const surge = surgeMultiplier > 1 ? Math.round(subtotal * (surgeMultiplier - 1)) : 0;
  const total = subtotal + surge;

  return {
    baseFare,
    distanceCharge,
    timeCharge,
    bookingFee,
    subtotal,
    minimumFareApplied,
    surge,
    total,
    platformFee: PLATFORM_FEE_KES,
    distanceKm,
    durationMinutes,
    currency: "KES",
  };
}
