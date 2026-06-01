/**
 * Shared-rides domain constants and types.
 * Values must match prisma/schema.prisma enums (run `npx prisma generate` after enum changes).
 */

export const SharedRideDirection = {
  to_sgr: "to_sgr",
  from_sgr: "from_sgr",
} as const;

export type SharedRideDirection =
  (typeof SharedRideDirection)[keyof typeof SharedRideDirection];

export const SgrTrainService = {
  inter_county: "inter_county",
  express: "express",
  night: "night",
} as const;

export type SgrTrainService = (typeof SgrTrainService)[keyof typeof SgrTrainService];

export const SharedDepartureStatus = {
  scheduled: "scheduled",
  boarding: "boarding",
  completed: "completed",
  cancelled: "cancelled",
} as const;

export type SharedDepartureStatus =
  (typeof SharedDepartureStatus)[keyof typeof SharedDepartureStatus];

export const SharedDepartureSeatStatus = {
  available: "available",
  reserved: "reserved",
  paid: "paid",
  disabled: "disabled",
} as const;

export type SharedDepartureSeatStatus =
  (typeof SharedDepartureSeatStatus)[keyof typeof SharedDepartureSeatStatus];

export const SharedTripRequestStatus = {
  open: "open",
  matched: "matched",
  cancelled: "cancelled",
  expired: "expired",
} as const;

export type SharedTripRequestStatus =
  (typeof SharedTripRequestStatus)[keyof typeof SharedTripRequestStatus];

export const SharedTripRequestReservationStatus = {
  active: "active",
  cancelled: "cancelled",
} as const;

export type SharedTripRequestReservationStatus =
  (typeof SharedTripRequestReservationStatus)[keyof typeof SharedTripRequestReservationStatus];

/** Minimal corridor point for zone resolve / maps. */
export type CorridorLocationRef = {
  id: string;
  slug: string;
  name: string;
  lat: number | null;
  lng: number | null;
};

/** Schedule slot fields used by suggestions and API DTOs. */
export type SgrScheduleSlotRef = {
  id: string;
  direction: SharedRideDirection;
  trainService: SgrTrainService;
  sgrEventTime: string;
  vanDepartureTime: string;
  suggestedPricePerSeat: number;
  pickupLocation: Pick<CorridorLocationRef, "id" | "slug" | "name">;
  dropoffLocation: Pick<CorridorLocationRef, "id" | "slug" | "name">;
};
