/**
 * Shared SGR / coast corridor — request validation + OpenAPI registration.
 *
 * Live routes: `src/routes/shared-rides.ts` (mounted at `/api/shared-rides`).
 * Integrator overview: `docs/SHARED_RIDES_API.md`.
 */

import { z } from "zod";
import { registry } from "./openapi-registry.js";
import { ErrorEnvelopeSchema } from "./common.schema.js";

const authResponses = {
  401: {
    description: "Missing or invalid session (`UNAUTHORIZED`).",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
} as const;

const invalidInputResponse = {
  400: {
    description:
      "Invalid query or path (`INVALID_INPUT`). Zod issues in `error.details.issues`.",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
} as const;

export const SharedRideDirectionSchema = z.enum(["to_sgr", "from_sgr"]);

/** ISO 8601 with `Z` or fixed offset (EAT responses use `+03:00`). */
const eatDatetimeSchema = z.string().datetime({ offset: true });

const CorridorLocationDtoSchema = z.object({
  id: z.string().openapi({ example: "clxyz123" }),
  slug: z.string().openapi({ example: "nyali" }),
  name: z.string().openapi({ example: "Nyali" }),
  lat: z.number().nullable().openapi({ example: -4.0207 }),
  lng: z.number().nullable().openapi({ example: 39.7199 }),
  radiusM: z.number().int().openapi({ example: 3500 }),
  sortOrder: z.number().int().openapi({ example: 20 }),
});

/** Path param for `GET /corridor-locations/:slug`. */
export const CorridorLocationSlugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, digits, and hyphens."),
});

export const CorridorLocationQuerySchema = z.object({
  slug: z.string().min(1).optional(),
});

export const ResolveCorridorLocationSchema = registry.register(
  "ResolveCorridorLocation",
  z
    .object({
      lat: z.number().min(-90).max(90).openapi({ example: -4.0207 }),
      lng: z.number().min(-180).max(180).openapi({ example: 39.7199 }),
    })
    .strict(),
);

export const ResolveCorridorLocationResponseSchema = registry.register(
  "ResolveCorridorLocationResponse",
  z.object({
    location: CorridorLocationDtoSchema,
    distanceM: z.number().int().openapi({ description: "Distance from GPS to zone center (metres)." }),
    insideRadius: z
      .boolean()
      .openapi({ description: "True when GPS is within the zone `radiusM` circle." }),
  }),
);

export const ScheduleSlotsQuerySchema = z.object({
  direction: SharedRideDirectionSchema.optional().openapi({
    description: "`to_sgr` = neighborhood → SGR Miritini; `from_sgr` = SGR → neighborhood.",
  }),
  corridorLocationId: z.string().min(1).optional().openapi({
    description: "Zone id (not SGR). Filters slots for that corridor.",
  }),
  corridorLocationSlug: z.string().min(1).optional().openapi({
    example: "nyali",
    description: "Alternative to corridorLocationId.",
  }),
});

export const SuggestionsQuerySchema = z.object({
  direction: SharedRideDirectionSchema.openapi({
    description: "Which timetable to use (van before train vs van after arrival).",
  }),
  corridorLocationId: z.string().min(1).optional(),
  corridorLocationSlug: z.string().min(1).optional().openapi({ example: "diani" }),
});

export const DeparturesSearchQuerySchema = z.object({
  direction: SharedRideDirectionSchema,
  corridorLocationId: z.string().min(1).optional(),
  corridorLocationSlug: z.string().min(1).optional().openapi({ example: "nyali" }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .openapi({ example: "2026-06-02", description: "ISO date (Nairobi calendar day)." }),
});

/** Body for one-tap intent — mirrors `suggestedTripRequests` items from GET suggestions/search. */
export const CreateTripRequestSchema = registry.register(
  "CreateTripRequest",
  z
    .object({
      sgrScheduleSlotId: z.string().min(1),
      direction: SharedRideDirectionSchema,
      corridorLocationId: z.string().min(1),
      departureDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .openapi({ example: "2026-06-02" }),
      vanDepartureAt: eatDatetimeSchema.openapi({
          example: "2026-06-02T06:00:00+03:00",
          description:
            "Van departure instant (EAT, ISO 8601 with +03:00). Copy from suggestions; Z is also accepted.",
        }),
      seatsRequested: z.number().int().min(1).max(6).optional().default(1),
      notes: z.string().max(500).optional(),
      pickupNote: z
        .string()
        .max(200)
        .optional()
        .openapi({ description: "Neighborhood pickup landmark or pin note for the driver." }),
    })
    .strict(),
);

const SgrScheduleSlotDtoSchema = z.object({
  id: z.string(),
  direction: SharedRideDirectionSchema,
  trainService: z.enum(["inter_county", "express", "night"]),
  sgrEventTime: z.string().openapi({ example: "08:00", description: "Train departs or arrives Miritini (HH:mm)." }),
  vanDepartureTime: z.string().openapi({ example: "06:00", description: "Van leaves neighborhood or SGR (HH:mm)." }),
  suggestedPricePerSeat: z.number().int().openapi({ example: 350 }),
  sortOrder: z.number().int(),
  pickupLocation: CorridorLocationDtoSchema,
  dropoffLocation: CorridorLocationDtoSchema,
});

const SuggestedTripRequestDtoSchema = z.object({
  sgrScheduleSlotId: z.string(),
  direction: SharedRideDirectionSchema,
  corridorLocationId: z.string(),
  corridorLocationSlug: z.string(),
  departureDate: z.string().openapi({ example: "2026-06-02" }),
  headline: z.string().openapi({ example: "Catch the 8:00 AM train to Nairobi" }),
  detail: z.string(),
  trainLabel: z.string(),
  vanDepartureAt: eatDatetimeSchema.openapi({
    example: "2026-06-02T06:00:00+03:00",
    description: "Van departure (EAT, +03:00).",
  }),
  pricePerSeat: z.number().int(),
  seatsRequested: z.number().int().openapi({ example: 1 }),
});

const SharedDepartureSearchItemSchema = z.object({
  id: z.string(),
  departureAt: eatDatetimeSchema.openapi({
    example: "2026-06-02T06:00:00+03:00",
    description: "Scheduled van departure (EAT, +03:00).",
  }),
  pricePerSeat: z.number().int(),
  capacity: z.number().int(),
  bookedSeatsCount: z.number().int(),
  availableSeats: z.number().int(),
  routeLabel: z.string().openapi({ example: "Nyali → SGR Miritini" }),
  driver: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      rating: z.number(),
    })
    .nullable(),
  sgrScheduleSlotId: z.string().nullable(),
});

export const CorridorLocationsResponseSchema = registry.register(
  "CorridorLocationsResponse",
  z.object({
    locations: z.array(CorridorLocationDtoSchema),
  }),
);

export const CorridorLocationResponseSchema = registry.register(
  "CorridorLocationResponse",
  z.object({
    location: CorridorLocationDtoSchema,
  }),
);

export const SgrScheduleSlotsResponseSchema = registry.register(
  "SgrScheduleSlotsResponse",
  z.object({
    slots: z.array(SgrScheduleSlotDtoSchema),
  }),
);

export const SharedRideSuggestionsResponseSchema = registry.register(
  "SharedRideSuggestionsResponse",
  z.object({
    suggestedTripRequests: z.array(SuggestedTripRequestDtoSchema),
  }),
);

export const SharedDeparturesSearchResponseSchema = registry.register(
  "SharedDeparturesSearchResponse",
  z.object({
    exactDepartures: z.array(SharedDepartureSearchItemSchema),
    otherDepartures: z.array(SharedDepartureSearchItemSchema),
    locations: z.array(CorridorLocationDtoSchema),
    suggestedTripRequests: z.array(SuggestedTripRequestDtoSchema),
  }),
);

const TripRequestReservationDtoSchema = z.object({
  id: z.string(),
  seatsRequested: z.number().int(),
  status: z.enum(["active", "cancelled"]),
  pickupNote: z.string().nullable(),
});

const TripRequestDtoSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "matched", "cancelled", "expired"]),
  poolSeatsTotal: z.number().int(),
  requestedDepartureAt: eatDatetimeSchema.openapi({
    example: "2026-06-02T06:00:00+03:00",
    description: "Pooled van departure (EAT, +03:00).",
  }),
  departureDate: z.string(),
  direction: SharedRideDirectionSchema,
  corridorLocation: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
  }),
  sgrScheduleSlotId: z.string(),
  headline: z.string(),
  detail: z.string(),
  trainLabel: z.string(),
  pricePerSeat: z.number().int(),
  notes: z.string().nullable(),
});

export const CreateTripRequestResponseSchema = registry.register(
  "CreateTripRequestResponse",
  z.object({
    tripRequest: TripRequestDtoSchema,
    reservation: TripRequestReservationDtoSchema,
  }),
);

export const MyTripRequestsResponseSchema = registry.register(
  "MyTripRequestsResponse",
  z.object({
    items: z.array(
      z.object({
        tripRequest: TripRequestDtoSchema,
        reservation: TripRequestReservationDtoSchema,
      }),
    ),
  }),
);

export const DepartureIdParamsSchema = z.object({
  departureId: z.string().trim().min(1).max(64),
});

const DepartureSeatDtoSchema = z.object({
  seatNumber: z.number().int(),
  status: z.enum(["available", "reserved", "paid", "disabled"]),
  isMine: z.boolean(),
  row: z.number().int().nullable(),
  col: z.number().int().nullable(),
});

export const SharedDepartureDetailSchema = registry.register(
  "SharedDepartureDetail",
  z.object({
    id: z.string(),
    departureAt: eatDatetimeSchema,
    pricePerSeat: z.number().int(),
    capacity: z.number().int(),
    status: z.string(),
    routeLabel: z.string(),
    pickupLocation: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
    dropoffLocation: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
    seats: z.array(DepartureSeatDtoSchema),
  }),
);

export const SharedDepartureDetailResponseSchema = registry.register(
  "SharedDepartureDetailResponse",
  z.object({ departure: SharedDepartureDetailSchema }),
);

export const ReserveDepartureSeatsSchema = registry.register(
  "ReserveDepartureSeats",
  z
    .object({
      seatNumbers: z
        .array(z.number().int().min(1))
        .min(1)
        .max(6)
        .openapi({ example: [3, 4], description: "1-based seat numbers on this van." }),
    })
    .strict(),
);

export const ReleaseDepartureSeatsSchema = registry.register(
  "ReleaseDepartureSeats",
  z
    .object({
      seatNumbers: z.array(z.number().int().min(1)).min(1).max(6).optional(),
    })
    .strict(),
);

export const ReserveDepartureSeatsResponseSchema = registry.register(
  "ReserveDepartureSeatsResponse",
  z.object({
    departure: SharedDepartureDetailSchema,
    reservedUntil: eatDatetimeSchema.openapi({
      description: "Hold expiry (EAT). Re-reserve or create booking before this time.",
    }),
  }),
);

export const CreateSharedDepartureBookingSchema = registry.register(
  "CreateSharedDepartureBooking",
  z
    .object({
      seatNumbers: z.array(z.number().int().min(1)).min(1).max(6),
    })
    .strict(),
);

export const SharedDepartureBookingDtoSchema = registry.register(
  "SharedDepartureBooking",
  z.object({
    id: z.string().openapi({ example: "BKG-clxyz" }),
    product: z.literal("shared_sgr"),
    sharedDepartureId: z.string(),
    status: z.enum(["pending_payment", "paid", "failed", "cancelled"]),
    seats: z.array(z.number().int()),
    subtotal: z.number().int(),
    platformFee: z.number().int(),
    total: z.number().int(),
    currency: z.string(),
    pickup: z.object({ label: z.string(), lat: z.number(), lng: z.number() }),
    dropoff: z.object({ label: z.string(), lat: z.number(), lng: z.number() }),
    createdAt: z.string().datetime(),
  }),
);

export const CreateSharedDepartureBookingResponseSchema = registry.register(
  "CreateSharedDepartureBookingResponse",
  z.object({ booking: SharedDepartureBookingDtoSchema }),
);

registry.registerPath({
  method: "get",
  path: "/api/shared-rides/corridor-locations",
  tags: ["Shared rides"],
  summary: "List coast corridor zones",
  description:
    "Active neighborhood zones and SGR Miritini. Used for zone pickers and GPS resolve (Phase 1). " +
    "Slugs: `mtwapa`, `nyali`, `bamburi`, `mombasa-cbd`, `diani`, `sgr-miritini`.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: {
      description: "Catalog of corridor locations.",
      content: { "application/json": { schema: CorridorLocationsResponseSchema } },
    },
    ...authResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/shared-rides/corridor-locations/resolve",
  tags: ["Shared rides"],
  summary: "Resolve GPS coordinates to a corridor zone",
  description:
    "Returns the nearest active zone. When the point lies inside multiple radii, the closest center wins. " +
    "`insideRadius` is false when GPS is outside all zone circles (still returns nearest for UI hints).",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ResolveCorridorLocationSchema } },
    },
  },
  responses: {
    200: {
      description: "Resolved zone.",
      content: { "application/json": { schema: ResolveCorridorLocationResponseSchema } },
    },
    ...invalidInputResponse,
    ...authResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/shared-rides/corridor-locations/{slug}",
  tags: ["Shared rides"],
  summary: "Get one corridor location",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    params: CorridorLocationSlugParamsSchema,
  },
  responses: {
    200: {
      description: "Single location.",
      content: { "application/json": { schema: CorridorLocationResponseSchema } },
    },
    ...invalidInputResponse,
    404: {
      description: "Unknown or inactive slug (`CORRIDOR_LOCATION_NOT_FOUND`).",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    ...authResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/shared-rides/sgr-schedule-slots",
  tags: ["Shared rides"],
  summary: "List Madaraka-aligned van/train slots",
  description:
    "Fixed timetable rows per zone (admin-seeded). Filter by direction and corridor zone. " +
    "Does not apply booking lead-time rules — use `/suggestions` for time-aware picks.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { query: ScheduleSlotsQuerySchema },
  responses: {
    200: {
      description: "Schedule slots.",
      content: { "application/json": { schema: SgrScheduleSlotsResponseSchema } },
    },
    ...invalidInputResponse,
    ...authResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/shared-rides/suggestions",
  tags: ["Shared rides"],
  summary: "Time-aware trip-request suggestions",
  description:
    "Returns up to `SHARED_RIDES_MAX_SUGGESTIONS` (default 2) slots based on Nairobi time, " +
    "booking lead minutes (`to_sgr`), and arrival grace (`from_sgr`). " +
    "Payload is ready for Phase 2 `POST /api/shared-rides/trip-requests`.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { query: SuggestionsQuerySchema },
  responses: {
    200: {
      description: "Suggested intents.",
      content: { "application/json": { schema: SharedRideSuggestionsResponseSchema } },
    },
    ...invalidInputResponse,
    ...authResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/shared-rides/departures/search",
  tags: ["Shared rides"],
  summary: "Browse scheduled shared vans",
  description:
    "Lists upcoming `SharedDeparture` rows for a zone + direction. " +
    "When none match, `suggestedTripRequests` offers one-tap intent creation (Phase 2).",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { query: DeparturesSearchQuerySchema },
  responses: {
    200: {
      description: "Departures and fallbacks.",
      content: { "application/json": { schema: SharedDeparturesSearchResponseSchema } },
    },
    ...invalidInputResponse,
    ...authResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/shared-rides/trip-requests",
  tags: ["Shared rides"],
  summary: "Create or join pooled trip request",
  description:
    "Passenger intent for a Madaraka slot. Reuses an open pool for the same slot + `vanDepartureAt`, " +
    "or creates one. Send the same fields as `suggestedTripRequests` from GET suggestions/search.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateTripRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Reservation created or updated.",
      content: { "application/json": { schema: CreateTripRequestResponseSchema } },
    },
    400: {
      description:
        "Invalid input, corridor mismatch, departure in past, or slot not bookable (`INVALID_INPUT`, `CORRIDOR_MISMATCH`, `DEPARTURE_IN_PAST`, `SLOT_NOT_BOOKABLE`).",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    404: {
      description: "Schedule slot not found (`SGR_SLOT_NOT_FOUND`).",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    ...authResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/shared-rides/trip-requests/mine",
  tags: ["Shared rides"],
  summary: "List my active trip requests",
  description: "Active reservations on open or matched pools with future van departure.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: {
      description: "Passenger trip requests.",
      content: { "application/json": { schema: MyTripRequestsResponseSchema } },
    },
    ...authResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/shared-rides/departures/{departureId}",
  tags: ["Shared rides"],
  summary: "Departure detail with seat map",
  description:
    "Scheduled van, route, and per-seat status. `isMine` is true when you hold a non-expired reservation.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: DepartureIdParamsSchema },
  responses: {
    200: {
      description: "Departure and seats.",
      content: { "application/json": { schema: SharedDepartureDetailResponseSchema } },
    },
    404: {
      description: "Not found or not bookable (`DEPARTURE_NOT_FOUND`, `DEPARTURE_CLOSED`).",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    ...invalidInputResponse,
    ...authResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/shared-rides/departures/{departureId}/seats/reserve",
  tags: ["Shared rides"],
  summary: "Hold seats before checkout",
  description:
    "Sets seats to `reserved` for `SHARED_RIDES_SEAT_RESERVE_MIN` minutes (default 15). " +
    "Paid or another passenger's active hold returns `SEAT_NOT_AVAILABLE`.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    params: DepartureIdParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: ReserveDepartureSeatsSchema } },
    },
  },
  responses: {
    200: {
      description: "Seats held.",
      content: { "application/json": { schema: ReserveDepartureSeatsResponseSchema } },
    },
    409: {
      description: "Seat unavailable (`SEAT_NOT_AVAILABLE`).",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    ...invalidInputResponse,
    ...authResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/shared-rides/departures/{departureId}/seats/release",
  tags: ["Shared rides"],
  summary: "Release held seats",
  description: "Clears your reservation holds. Omit `seatNumbers` to release all seats you hold on this departure.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    params: DepartureIdParamsSchema,
    body: {
      content: { "application/json": { schema: ReleaseDepartureSeatsSchema } },
    },
  },
  responses: {
    200: {
      description: "Updated seat map.",
      content: { "application/json": { schema: SharedDepartureDetailResponseSchema } },
    },
    ...invalidInputResponse,
    ...authResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/shared-rides/departures/{departureId}/bookings",
  tags: ["Shared rides"],
  summary: "Create shared departure booking",
  description:
    "Creates a `shared_sgr` booking for held seats. Pay with `POST /api/bookings/{id}/pay` (same as on-demand). " +
    "On successful payment, linked seats become `paid`.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    params: DepartureIdParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: CreateSharedDepartureBookingSchema } },
    },
  },
  responses: {
    201: {
      description: "Booking created (`pending_payment`).",
      content: { "application/json": { schema: CreateSharedDepartureBookingResponseSchema } },
    },
    409: {
      description:
        "Seats not held, unpaid booking pending, or departure closed (`SEATS_NOT_HELD`, `UNPAID_BOOKING_PENDING`, `DEPARTURE_CLOSED`).",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    ...invalidInputResponse,
    ...authResponses,
  },
});
