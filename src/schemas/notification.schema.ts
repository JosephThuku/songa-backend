import { z } from "zod";
import { ErrorEnvelopeSchema } from "./common.schema.js";
import { registry } from "./openapi-registry.js";

export const NotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});

export const RegisterDeviceRequestSchema = registry.register(
  "RegisterDeviceRequest",
  z.object({
    pushToken: z.string().min(1),
    platform: z.enum(["ios", "android"]),
  }).strict(),
);

registry.registerPath({
  method: "get",
  path: "/api/notifications",
  tags: ["Notifications"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: { description: "Notification inbox." },
    401: { description: "Unauthorized.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/devices",
  tags: ["Notifications"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: RegisterDeviceRequestSchema } } } },
  responses: {
    200: { description: "Device registered." },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

