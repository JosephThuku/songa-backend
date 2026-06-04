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
  /** `from_sgr` demo van (optional second Path A). */
  fromSgrMtwapa: {
    direction: "from_sgr" as const,
    corridorLocationSlug: "mtwapa",
    demoDepartureId: "dep_seed_mtwapa_from_sgr",
  },
} as const;

export function sharedRideSearchQuery(slug: string, direction: "to_sgr" | "from_sgr"): string {
  return `/api/shared-rides/departures/search?direction=${direction}&corridorLocationSlug=${slug}`;
}
