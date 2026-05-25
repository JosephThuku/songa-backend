import { z } from "zod";
import { registry } from "./openapi-registry.js";
import { ErrorEnvelopeSchema } from "./common.schema.js";

const PlaceSchema = z
  .object({
    placeId: z.string().optional(),
    label: z.string().trim().min(1),
    lat: z.number(),
    lng: z.number(),
  })
  .strict();

const VehicleEmbedSchema = z.object({
  id: z.string(),
  type: z.string(),
  make: z.string(),
  model: z.string(),
  registration: z.string(),
  color: z.string(),
  year: z.string().nullable(),
  seats: z.number().int(),
  status: z.string(),
});

const PersonEmbedSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  rating: z.number(),
});

const RideDtoSchema = registry.register(
  "Ride",
  z.object({
    id: z.string(),
    tripId: z.string().nullable(),
    vehicleType: z.string().nullable(),
    passengerId: z.string(),
    driverId: z.string().nullable(),
    phase: z.enum([
      "finding_driver",
      "driver_accepted",
      "driver_en_route",
      "driver_arriving",
      "driver_arrived",
      "trip_in_progress",
      "trip_ended",
      "cancelled",
    ]),
    bookingMode: z.enum(["seat_selection", "pay_on_arrival"]),
    prepaid: z.boolean(),
    bookingId: z.string().nullable(),
    paymentMethod: z.string().nullable(),
    price: z.number().int(),
    currency: z.string(),
    etaMinutes: z.number().int().nullable(),
    distanceKm: z.number().nullable(),
    driverProgress: z.number(),
    passengerBoarded: z.boolean(),
    seats: z.array(z.number().int()).nullable(),
    pickup: PlaceSchema,
    dropoff: PlaceSchema,
    driverLocation: z.unknown().nullable(),
    cancelReason: z.unknown().nullable(),
    cancelledByRole: z.enum(["passenger", "driver", "system"]).nullable(),
    passengerDriverRating: z.number().int().min(1).max(5).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    passenger: PersonEmbedSchema,
    driver: PersonEmbedSchema.nullable(),
    vehicle: VehicleEmbedSchema.nullable(),
  }),
);

const RideSearchOptionSchema = z.object({
  optionId: z.string(),
  vehicleType: z.string(),
  label: z.string(),
  capacity: z.number().int(),
  available: z.boolean(),
  pickupEtaMinutes: z.number().int().nullable(),
  priceAmount: z.number().int().nullable(),
  currency: z.literal("KES"),
});

export const SearchRideRequestSchema = registry.register(
  "SearchRideRequest",
  z
    .object({
      pickup: PlaceSchema,
      dropoff: PlaceSchema,
    })
    .strict(),
);

export const SearchRideResponseSchema = registry.register(
  "SearchRideResponse",
  z.object({
    pickup: PlaceSchema,
    dropoff: PlaceSchema,
    tripDurationMinutes: z.number().int(),
    bookingMode: z.enum(["seat_selection", "pay_on_arrival"]),
    requiresSeats: z.boolean(),
    options: z.array(RideSearchOptionSchema),
  }),
);

export const RequestRideRequestSchema = registry.register(
  "RequestRideRequest",
  z
    .object({
      optionId: z.string().optional(),
      tripId: z.string().optional(),
      listingId: z.string().optional(),
      preferredDriverId: z.string().optional(),
      pickup: PlaceSchema,
      dropoff: PlaceSchema,
      seats: z.array(z.number().int().positive()).optional(),
      prepaid: z.boolean().optional().default(false),
      bookingId: z.string().optional(),
      paymentMethod: z.enum(["mpesa", "card"]).nullable().optional(),
    })
    .strict(),
);

export const RateDriverRequestSchema = registry.register(
  "RateDriverRequest",
  z
    .object({
      stars: z.number().int().min(1).max(5),
    })
    .strict(),
);

export const CancelRideRequestSchema = registry.register(
  "CancelRideRequest",
  z
    .object({
      reasonId: z.enum([
        "plans_changed",
        "wait_too_long",
        "found_another",
        "wrong_location",
        "driver_asked",
        "other",
      ]),
      reasonLabel: z.string().trim().min(1),
      detail: z.string().nullable().optional(),
    })
    .strict(),
);

const RideResponseSchema = registry.register("RideResponse", z.object({ ride: RideDtoSchema }));
const ActiveRideResponseSchema = registry.register("ActiveRideResponse", z.object({ ride: RideDtoSchema.nullable() }));
const OkResponseSchema = registry.register("OkResponse", z.object({ ok: z.literal(true) }));

registry.registerPath({
  method: "post",
  path: "/api/rides/search",
  tags: ["Rides"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: SearchRideRequestSchema } } } },
  responses: {
    200: { description: "Ride options near pickup.", content: { "application/json": { schema: SearchRideResponseSchema } } },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/rides/request",
  tags: ["Rides"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: RequestRideRequestSchema } } } },
  responses: {
    201: { description: "Ride created.", content: { "application/json": { schema: RideResponseSchema } } },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    409: { description: "Ride conflict.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/rides/active/stream",
  tags: ["Rides"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: {
      description: "SSE stream of ride.updated and ride.ended events for the authenticated user's ride.",
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
    },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

for (const [method, path] of [
  ["get", "/api/rides/active"],
  ["get", "/api/rides/{rideId}"],
  ["post", "/api/rides/{rideId}/cancel"],
  ["post", "/api/rides/{rideId}/accept"],
  ["post", "/api/rides/{rideId}/decline"],
  ["post", "/api/rides/{rideId}/arrived"],
  ["post", "/api/rides/{rideId}/start"],
  ["post", "/api/rides/{rideId}/complete"],
  ["post", "/api/rides/{rideId}/rate"],
] as const) {
  registry.registerPath({
    method,
    path,
    tags: ["Rides"],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    request: path.endsWith("/cancel")
      ? { body: { required: true, content: { "application/json": { schema: CancelRideRequestSchema } } } }
      : path.endsWith("/rate")
        ? { body: { required: true, content: { "application/json": { schema: RateDriverRequestSchema } } } }
        : undefined,
    responses: {
      200: {
        description: "Ride response.",
        content: {
          "application/json": {
            schema: path.endsWith("/decline")
              ? OkResponseSchema
              : path.endsWith("/active")
                ? ActiveRideResponseSchema
                : RideResponseSchema,
          },
        },
      },
      404: { description: "Ride not found.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
      409: { description: "Invalid ride state.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    },
  });
}
