import type { RidePhase } from "@prisma/client";

export const TERMINAL_RIDE_PHASES: RidePhase[] = ["trip_ended", "cancelled"];

export function isTerminalPhase(phase: RidePhase): boolean {
  return TERMINAL_RIDE_PHASES.includes(phase);
}

export function canPassengerCancelTrip(phase: RidePhase): boolean {
  return ["finding_driver", "driver_accepted", "driver_en_route", "driver_arriving"].includes(phase);
}

export function canDriverAcceptOffer(phase: RidePhase): boolean {
  return phase === "finding_driver";
}

export function canDriverStartTrip(phase: RidePhase): boolean {
  return phase === "driver_arrived";
}

export function canDriverEndTrip(phase: RidePhase): boolean {
  return phase === "trip_in_progress";
}

export function canDriverMarkArrived(phase: RidePhase): boolean {
  return ["driver_accepted", "driver_en_route", "driver_arriving"].includes(phase);
}

