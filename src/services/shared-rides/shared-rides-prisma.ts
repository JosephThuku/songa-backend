/** Shared Prisma select/include shapes (no `satisfies Prisma.*` — avoids IDE errors when client is stale). */

export const corridorLocationBriefSelect = {
  id: true,
  slug: true,
  name: true,
  lat: true,
  lng: true,
} as const;

export const sgrSlotWithLocationsInclude = {
  pickupLocation: { select: corridorLocationBriefSelect },
  dropoffLocation: { select: corridorLocationBriefSelect },
} as const;

export type CorridorLocationBrief = {
  id: string;
  slug: string;
  name: string;
  lat: number | null;
  lng: number | null;
};

export type SgrScheduleSlotWithLocations = {
  id: string;
  direction: "to_sgr" | "from_sgr";
  trainService: "inter_county" | "express" | "night";
  sgrEventTime: string;
  vanDepartureTime: string;
  suggestedPricePerSeat: number;
  pickupLocation: CorridorLocationBrief;
  dropoffLocation: CorridorLocationBrief;
};

export type SharedTripRequestWithRelations = {
  id: string;
  status: string;
  seatsRequested: number;
  requestedDepartureAt: Date;
  departureDate: string;
  direction: "to_sgr" | "from_sgr";
  sgrScheduleSlotId: string;
  matchedDepartureId: string | null;
  notes: string | null;
  corridorLocation: CorridorLocationBrief;
  sgrScheduleSlot: SgrScheduleSlotWithLocations;
};
