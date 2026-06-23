import { z } from "zod";
import { ErrorEnvelopeSchema } from "./common.schema.js";
import { registry } from "./openapi-registry.js";

const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

const UserRoleSchema = z.enum(["passenger", "driver", "admin"]);
const OnboardingStatusSchema = z.enum(["pending", "approved", "rejected"]);
const BookingStatusSchema = z.enum(["pending_payment", "paid", "failed", "cancelled"]);
const BookingProductSchema = z.enum(["on_demand", "shared_sgr"]);
const RidePhaseSchema = z.enum([
  "finding_driver",
  "driver_accepted",
  "driver_en_route",
  "driver_arriving",
  "driver_arrived",
  "trip_in_progress",
  "trip_ended",
  "cancelled",
]);

export const AdminUserQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  role: UserRoleSchema.optional(),
});
export type AdminUserQuery = z.infer<typeof AdminUserQuerySchema>;

export const AdminDriverQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  onboardingStatus: OnboardingStatusSchema.optional(),
});
export type AdminDriverQuery = z.infer<typeof AdminDriverQuerySchema>;

export const AdminUpdateDriverStatusSchema = registry.register(
  "AdminUpdateDriverStatus",
  z.object({ onboardingStatus: OnboardingStatusSchema }).strict(),
);
export type AdminUpdateDriverStatusInput = z.infer<typeof AdminUpdateDriverStatusSchema>;

export const AdminBookingQuerySchema = PageQuerySchema.extend({
  status: BookingStatusSchema.optional(),
  product: BookingProductSchema.optional(),
  passengerId: z.string().min(1).optional(),
  sharedDepartureId: z.string().min(1).optional(),
});
export type AdminBookingQuery = z.infer<typeof AdminBookingQuerySchema>;

export const AdminRideQuerySchema = PageQuerySchema.extend({
  phase: RidePhaseSchema.optional(),
  passengerId: z.string().min(1).optional(),
  driverId: z.string().min(1).optional(),
  prepaid: z.coerce.boolean().optional(),
  paymentChannel: z.enum(["cash", "mpesa"]).optional(),
});
export type AdminRideQuery = z.infer<typeof AdminRideQuerySchema>;

export const AdminWalletQuerySchema = PageQuerySchema.extend({
  driverId: z.string().min(1).optional(),
  type: z.string().trim().min(1).max(64).optional(),
  status: z.string().trim().min(1).max(64).optional(),
});
export type AdminWalletQuery = z.infer<typeof AdminWalletQuerySchema>;

const adminErrors = {
  400: {
    description: "Invalid input.",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
  401: {
    description: "Missing or invalid session.",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
  403: {
    description: "Authenticated but not an admin.",
    content: { "application/json": { schema: ErrorEnvelopeSchema } },
  },
} as const;

function registerAdminGet(path: string, summary: string) {
  registry.registerPath({
    method: "get",
    path,
    tags: ["Admin"],
    summary,
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    responses: {
      200: { description: "Admin response." },
      404: { description: "Not found.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
      ...adminErrors,
    },
  });
}

registerAdminGet("/api/admin/users", "List users");
registerAdminGet("/api/admin/users/{id}", "Get user detail");
registerAdminGet("/api/admin/drivers", "List drivers");
registerAdminGet("/api/admin/drivers/{id}", "Get driver detail");
registerAdminGet("/api/admin/bookings", "List bookings");
registerAdminGet("/api/admin/bookings/{id}", "Get booking detail");
registerAdminGet("/api/admin/rides", "List rides");
registerAdminGet("/api/admin/rides/{id}", "Get ride detail");
registerAdminGet("/api/admin/wallet-transactions", "List wallet transactions");
registerAdminGet("/api/admin/cashouts", "List cashout requests");

registry.registerPath({
  method: "patch",
  path: "/api/admin/drivers/{id}/status",
  tags: ["Admin"],
  summary: "Update driver onboarding status",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: AdminUpdateDriverStatusSchema } },
    },
  },
  responses: {
    200: { description: "Driver status updated." },
    404: { description: "Driver not found.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    ...adminErrors,
  },
});
