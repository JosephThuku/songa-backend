import { z } from "zod";

const PlaceSchema = z.object({
  placeId: z.string().optional(),
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export const RideUpdatedEventSchema = z.object({
  type: z.literal("ride.updated"),
  ride: z.record(z.unknown()),
});

export const RideOfferEventSchema = z.object({
  type: z.literal("ride.offer"),
  offer: z.object({
    rideId: z.string(),
    pickup: z.unknown(),
    dropoff: z.unknown(),
    price: z.number().int(),
    currency: z.string(),
    bookingMode: z.string(),
    passengerName: z.string().nullable(),
    expiresAt: z.string(),
  }),
});

export const RideEndedEventSchema = z.object({
  type: z.literal("ride.ended"),
  rideId: z.string(),
  phase: z.string(),
});

export const RideCancelledEventSchema = z.object({
  type: z.literal("ride.cancelled"),
  rideId: z.string(),
  phase: z.literal("cancelled"),
});

export type RideUpdatedEvent = z.infer<typeof RideUpdatedEventSchema>;
export type RideOfferEvent = z.infer<typeof RideOfferEventSchema>;
export type RideEndedEvent = z.infer<typeof RideEndedEventSchema>;
export type RideCancelledEvent = z.infer<typeof RideCancelledEventSchema>;

export type RealtimeEventName = "ride.updated" | "ride.offer" | "ride.ended" | "ride.cancelled";

export { PlaceSchema };
