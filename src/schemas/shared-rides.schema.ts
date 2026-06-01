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
  vanDepartureAt: z.string().datetime(),
  pricePerSeat: z.number().int(),
  seatsRequested: z.number().int().openapi({ example: 1 }),
});

const SharedDepartureSearchItemSchema = z.object({
  id: z.string(),
  departureAt: z.string().datetime(),
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
