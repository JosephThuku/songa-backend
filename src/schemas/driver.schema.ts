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

export const DriverLocationRequestSchema = registry.register(
  "DriverLocationRequest",
  z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      heading: z.number().min(0).max(360).optional(),
      speedKmh: z.number().min(0).optional(),
      accuracyM: z.number().min(0).optional(),
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
    409: { description: "Driver offline.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
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
