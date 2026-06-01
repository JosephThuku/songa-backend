import { z } from "zod";
import { registry } from "./openapi-registry.js";
import { ErrorEnvelopeSchema } from "./common.schema.js";
import { SharedRideDirectionSchema } from "./shared-rides.schema.js";

const timeHmSchema = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/, "Use HH:mm (24h), e.g. 08:00");

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, digits, and hyphens.");

export const AdminCreateCorridorLocationSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  radiusM: z.number().int().min(100).max(50_000).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export const AdminUpdateCorridorLocationSchema = AdminCreateCorridorLocationSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field is required." },
);

export const AdminCreateSgrScheduleSlotSchema = z.object({
  pickupLocationId: z.string().min(1),
  dropoffLocationId: z.string().min(1),
  direction: SharedRideDirectionSchema,
  trainService: z.enum(["inter_county", "express", "night"]),
  sgrEventTime: timeHmSchema,
  vanDepartureTime: timeHmSchema,
  suggestedPricePerSeat: z.number().int().min(1).max(999_999),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export const AdminUpdateSgrScheduleSlotSchema = AdminCreateSgrScheduleSlotSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field is required." },
);

const adminErrors = {
  400: {
    description: "Invalid input (`INVALID_INPUT`).",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
  401: {
    description: "Missing or invalid session (`UNAUTHORIZED`).",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
  403: {
    description: "Authenticated but not an admin (`FORBIDDEN`).",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
} as const;

const CorridorLocationBodySchema = registry.register(
  "AdminCorridorLocationBody",
  AdminCreateCorridorLocationSchema,
);

registry.registerPath({
  method: "post",
  path: "/api/admin/shared-rides/corridor-locations",
  tags: ["Shared rides (admin)"],
  summary: "Create corridor location",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: CorridorLocationBodySchema } } },
  },
  responses: {
    201: { description: "Location created." },
    ...adminErrors,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/admin/shared-rides/corridor-locations/{id}",
  tags: ["Shared rides (admin)"],
  summary: "Update corridor location",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: AdminUpdateCorridorLocationSchema } },
    },
  },
  responses: {
    200: { description: "Location updated." },
    404: { description: "Not found." },
    ...adminErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/admin/shared-rides/corridor-locations/{id}",
  tags: ["Shared rides (admin)"],
  summary: "Deactivate corridor location",
  description: "Soft-delete: sets `isActive` to false.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: { description: "Location deactivated." },
    404: { description: "Not found." },
    ...adminErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/shared-rides/sgr-schedule-slots",
  tags: ["Shared rides (admin)"],
  summary: "Create SGR schedule slot",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: AdminCreateSgrScheduleSlotSchema } },
    },
  },
  responses: {
    201: { description: "Slot created." },
    409: { description: "Duplicate slot (`SGR_SLOT_CONFLICT`)." },
    ...adminErrors,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/admin/shared-rides/sgr-schedule-slots/{id}",
  tags: ["Shared rides (admin)"],
  summary: "Update SGR schedule slot",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: AdminUpdateSgrScheduleSlotSchema } },
    },
  },
  responses: {
    200: { description: "Slot updated." },
    404: { description: "Not found." },
    409: { description: "Duplicate slot." },
    ...adminErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/admin/shared-rides/sgr-schedule-slots/{id}",
  tags: ["Shared rides (admin)"],
  summary: "Deactivate SGR schedule slot",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: { description: "Slot deactivated." },
    404: { description: "Not found." },
    ...adminErrors,
  },
});
