import { EventEmitter } from "node:events";
import type { RidePhase } from "@prisma/client";

export interface RideChangedEvent {
  rideId: string;
  phase: RidePhase;
}

export interface RideOfferEvent {
  driverId: string;
  offer: {
    rideId: string;
    pickup: unknown;
    dropoff: unknown;
    price: number;
    currency: string;
    bookingMode: string;
    passengerName: string | null;
    expiresAt: string;
  };
}

const bus = new EventEmitter();
bus.setMaxListeners(200);

const RIDE_CHANGED = "ride.changed";
const RIDE_OFFER = "ride.offer";

export function publishRideChanged(event: RideChangedEvent): void {
  bus.emit(RIDE_CHANGED, event);
}

/** Apply a ride.changed event received from Redis (do not re-publish upstream). */
export function ingestRideChanged(event: RideChangedEvent): void {
  bus.emit(RIDE_CHANGED, event);
}

export function onRideChanged(listener: (event: RideChangedEvent) => void): () => void {
  bus.on(RIDE_CHANGED, listener);
  return () => bus.off(RIDE_CHANGED, listener);
}

export function publishRideOffer(event: RideOfferEvent): void {
  bus.emit(RIDE_OFFER, event);
}

export function ingestRideOffer(event: RideOfferEvent): void {
  bus.emit(RIDE_OFFER, event);
}

export function onRideOffer(listener: (event: RideOfferEvent) => void): () => void {
  bus.on(RIDE_OFFER, listener);
  return () => bus.off(RIDE_OFFER, listener);
}
