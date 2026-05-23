// Shared Zod schemas for every server -> client realtime event we emit
// over Socket.io (and, for parity, the SSE fallback at /api/rides/active/stream).
//
// Every emitter should validate its payload through `safeValidate` before
// calling `io.to(...).emit(...)`. In dev/test we throw on drift so it is
// caught loudly; in prod we log and emit anyway so a schema bug never
// silences a customer-facing event.

import { z } from "zod";
import { logger } from "./logger.js";

// Loose shape — RideDto is large; we only need to confirm it is an object
// with the few invariants every consumer relies on. The full DTO contract
// lives in src/lib/responses.ts and the OpenAPI schema.
const RideDtoLikeSchema = z
  .object({
    id: z.string(),
    phase: z.string(),
    passengerId: z.string(),
    driverId: z.string().nullable(),
  })
  .passthrough();

const RideOfferPayloadSchema = z.object({
  rideId: z.string(),
  pickup: z.unknown(),
  dropoff: z.unknown(),
  price: z.number(),
  currency: z.string(),
  bookingMode: z.string(),
  passengerName: z.string().nullable(),
  expiresAt: z.string(),
});

export const RideUpdatedEventSchema = z.object({
  type: z.literal("ride.updated"),
  ride: RideDtoLikeSchema,
});

export const RideOfferEventSchema = z.object({
  type: z.literal("ride.offer"),
  offer: RideOfferPayloadSchema,
});

export const RideEndedEventSchema = z.object({
  type: z.literal("ride.ended"),
  rideId: z.string(),
  phase: z.string(),
});

export type RideUpdatedEvent = z.infer<typeof RideUpdatedEventSchema>;
export type RideOfferEvent = z.infer<typeof RideOfferEventSchema>;
export type RideEndedEvent = z.infer<typeof RideEndedEventSchema>;

export type RealtimeEventName = "ride.updated" | "ride.offer" | "ride.ended";

interface ValidateContext {
  event: RealtimeEventName;
  isProduction: boolean;
}

export function safeValidate<T extends z.ZodTypeAny>(
  schema: T,
  payload: unknown,
  ctx: ValidateContext,
): z.infer<T> {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  if (!ctx.isProduction) {
    throw new Error(
      `Realtime event ${ctx.event} failed schema validation: ${JSON.stringify(result.error.issues)}`,
    );
  }
  logger.error(
    { event: ctx.event, issues: result.error.issues },
    "realtime event payload failed schema validation; emitting anyway",
  );
  return payload as z.infer<T>;
}
