import { z } from "zod";
import { registry } from "./openapi-registry.js";
import { ErrorEnvelopeSchema } from "./common.schema.js";

export const DriverOnlineRequestSchema = registry.register(
  "DriverOnlineRequest",
  z.object({ isOnline: z.boolean() }).strict(),
);

export const DriverOnlineResponseSchema = registry.register(
  "DriverOnlineResponse",
  z.object({
    isOnline: z.boolean(),
    onlineSince: z.string().datetime().nullable(),
  }),
);

function optionalGpsNumber(min: number, max: number) {
  return z.preprocess((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (value < min || value > max) return undefined;
    return value;
  }, z.number().min(min).max(max).optional());
}

export const DriverLocationRequestSchema = registry.register(
  "DriverLocationRequest",
  z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      // Expo/iOS often sends heading -1 when unavailable; ignore instead of 400.
      heading: optionalGpsNumber(0, 360),
      speedKmh: optionalGpsNumber(0, 1_000),
      accuracyM: optionalGpsNumber(0, 10_000),
      recordedAt: z.string().datetime().optional(),
    })
    .strict(),
);

export const NearbyDriversQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  vehicleType: z.enum(["Car", "Van", "Minibus", "Bike", "Tuktuk", "All"]).optional().default("All"),
  radiusKm: z.coerce.number().positive().max(100).optional().default(25),
});

registry.registerPath({
  method: "patch",
  path: "/api/drivers/me/online",
  tags: ["Drivers"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: DriverOnlineRequestSchema } } } },
  responses: {
    200: { description: "Online state updated.", content: { "application/json": { schema: DriverOnlineResponseSchema } } },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    403: { description: "Driver not approved.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/drivers/me/location",
  tags: ["Drivers"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: DriverLocationRequestSchema } } } },
  responses: {
    204: { description: "Location accepted." },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    403: { description: "Driver not approved.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

export const RegisterVehicleRequestSchema = registry.register(
  "RegisterVehicleRequest",
  z
    .object({
      type: z.enum(["Car", "Van", "Minibus"]),
      make: z.string().trim().min(1),
      model: z.string().trim().min(1),
      registration: z.string().trim().min(1),
      color: z.string().trim().min(1),
      year: z.string().trim().optional(),
      seats: z.number().int().min(1).max(60),
    })
    .strict(),
);

const VehicleResponseSchema = registry.register(
  "VehicleResponse",
  z.object({
    vehicle: z.object({
      id: z.string(),
      type: z.string(),
      make: z.string(),
      model: z.string(),
      registration: z.string(),
      color: z.string(),
      year: z.string().nullable(),
      seats: z.number().int(),
      status: z.string(),
    }),
  }),
);

registry.registerPath({
  method: "post",
  path: "/api/drivers/me/vehicle",
  tags: ["Drivers"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: RegisterVehicleRequestSchema } } } },
  responses: {
    200: { description: "Vehicle registered.", content: { "application/json": { schema: VehicleResponseSchema } } },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    403: { description: "Driver not approved.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/drivers/nearby",
  tags: ["Drivers"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: { description: "Nearby online drivers." },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});
