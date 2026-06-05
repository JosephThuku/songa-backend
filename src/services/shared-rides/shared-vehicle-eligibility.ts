import type { Vehicle } from "@prisma/client";
import { sharedRidesAllowedVehicleTypes, sharedRidesMinBookableSeats } from "../../config/shared-rides.js";
import { AppError } from "../../lib/errors.js";

/** Ensure the vehicle has at least one bookable passenger seat; optional type allow-list via env. */
export function assertVehicleEligibleForSharedDeparture(
  vehicle: Vehicle,
  bookableSeatCount: number,
): void {
  const minSeats = sharedRidesMinBookableSeats();
  if (bookableSeatCount < minSeats) {
    throw new AppError(
      "VEHICLE_NOT_ELIGIBLE_FOR_SHARED",
      409,
      `Shared vans need at least ${minSeats} bookable seats. This vehicle has ${bookableSeatCount}.`,
    );
  }

  const allowedTypes = sharedRidesAllowedVehicleTypes();
  if (allowedTypes && !allowedTypes.includes(vehicle.type)) {
    throw new AppError(
      "VEHICLE_NOT_ELIGIBLE_FOR_SHARED",
      409,
      `Vehicle type "${vehicle.type}" is not eligible for shared SGR vans.`,
    );
  }
}
