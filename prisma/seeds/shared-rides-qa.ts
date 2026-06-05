/**
 * Dev QA routes for shared-rides mobile (Joseph integration guide).
 * Use after `npm run db:seed` or `npm run db:seed:shared-rides`.
 */

export const QA_SHARED_RIDE_ROUTES = {
  /** Returns `exactDepartures` with demo vans (morning + 10 PM train slot). */
  withDepartures: {
    direction: "to_sgr" as const,
    corridorLocationSlug: "nyali",
    demoDepartureIds: ["dep_seed_nyali_sgr_morning", "dep_seed_nyali_sgr_night"] as const,
    demoDepartureId: "dep_seed_nyali_sgr_morning",
    nightTrainDepartureId: "dep_seed_nyali_sgr_night",
  },
  /** Returns empty `exactDepartures` but `suggestedTripRequests` — Path B trip request. */
  withoutDepartures: {
    direction: "to_sgr" as const,
    corridorLocationSlug: "mombasa-cbd",
    seededOpenTripRequestId: "trip_req_seed_cbd_express",
  },
  /** `from_sgr` demo vans (Nyali + Bamburi + legacy Mtwapa). */
  fromSgrNyali: {
    direction: "from_sgr" as const,
    corridorLocationSlug: "nyali",
    demoDepartureIds: ["dep_seed_sgr_nyali_van", "dep_seed_sgr_nyali_car"] as const,
    vanDepartureId: "dep_seed_sgr_nyali_van",
    carDepartureId: "dep_seed_sgr_nyali_car",
  },
  fromSgrBamburi: {
    direction: "from_sgr" as const,
    corridorLocationSlug: "bamburi",
    demoDepartureIds: ["dep_seed_sgr_bamburi_van", "dep_seed_sgr_bamburi_car"] as const,
    vanDepartureId: "dep_seed_sgr_bamburi_van",
    carDepartureId: "dep_seed_sgr_bamburi_car",
  },
  toSgrBamburi: {
    direction: "to_sgr" as const,
    corridorLocationSlug: "bamburi",
    demoDepartureIds: [
      "dep_seed_bamburi_sgr_morning",
      "dep_seed_bamburi_sgr_van_express",
      "dep_seed_bamburi_sgr_car",
    ] as const,
  },
  fromSgrMtwapa: {
    direction: "from_sgr" as const,
    corridorLocationSlug: "mtwapa",
    demoDepartureId: "dep_seed_mtwapa_from_sgr",
  },
} as const;

export function sharedRideSearchQuery(slug: string, direction: "to_sgr" | "from_sgr"): string {
  return `/api/shared-rides/departures/search?direction=${direction}&corridorLocationSlug=${slug}`;
}
