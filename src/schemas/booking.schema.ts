import { z } from "zod";
import { ErrorEnvelopeSchema } from "./common.schema.js";
import { registry } from "./openapi-registry.js";

const PlaceSchema = z.object({
  placeId: z.string().optional(),
  label: z.string().trim().min(1),
  lat: z.number(),
  lng: z.number(),
}).strict();

export const CreateBookingRequestSchema = registry.register(
  "CreateBookingRequest",
  z.object({
    tripId: z.string().optional(),
    pickup: PlaceSchema,
    dropoff: PlaceSchema,
    seats: z.array(z.number().int().positive()).min(1),
  }).strict(),
);

export const PayBookingRequestSchema = registry.register(
  "PayBookingRequest",
  z
    .object({
      provider: z.enum(["flutterwave", "mpesa"]).default("mpesa"),
      /** Required for M-Pesa STK when not using ALLOW_DEV_PAYMENT_CONFIRM. */
      phone: z.string().trim().min(9).max(20).optional(),
      /** STK push (default). Paybill/Till are intentionally disabled until C2B reconciliation is implemented. */
      mpesaChannel: z.enum(["stk", "paybill", "till"]).optional(),
    })
    .strict(),
);

registry.registerPath({
  method: "post",
  path: "/api/bookings",
  tags: ["Bookings"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: CreateBookingRequestSchema } } } },
  responses: {
    201: { description: "Booking created." },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bookings/{id}/pay",
  tags: ["Bookings"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: false, content: { "application/json": { schema: PayBookingRequestSchema } } } },
  responses: {
    200: { description: "Payment session created." },
    404: { description: "Booking not found.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/bookings/{id}",
  tags: ["Bookings"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: { description: "Booking status." },
    404: { description: "Booking not found.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});
