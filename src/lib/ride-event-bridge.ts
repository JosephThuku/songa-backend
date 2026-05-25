import { Redis as IORedis } from "ioredis";
import { logger } from "./logger.js";
import { getRedis, IoredisClient } from "./redis.js";
import {
  ingestRideChanged,
  ingestRideOffer,
  onRideChanged,
  onRideOffer,
  type RideChangedEvent,
  type RideOfferEvent,
} from "./ride-events.js";

const CHANNEL_CHANGED = "songa:ride.changed";
const CHANNEL_OFFER = "songa:ride.offer";

async function publishJson(channel: string, payload: unknown): Promise<void> {
  const redis = getRedis();
  if (!(redis instanceof IoredisClient)) return;
  try {
    await redis.publish(channel, JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err, channel }, "redis ride event publish failed");
  }
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Mirror ride events across pods via Redis pub/sub when REDIS_URL is set. */
export function startRideEventBridge(): () => void {
  const unsubChanged = onRideChanged((event: RideChangedEvent) => {
    void publishJson(CHANNEL_CHANGED, event);
  });
  const unsubOffer = onRideOffer((event: RideOfferEvent) => {
    void publishJson(CHANNEL_OFFER, event);
  });

  const url = process.env.REDIS_URL;
  if (!url) {
    return () => {
      unsubChanged();
      unsubOffer();
    };
  }

  const subscriber = new IORedis(url, { maxRetriesPerRequest: null });
  subscriber.on("error", (err) => logger.error({ err }, "redis ride bridge subscriber error"));

  void subscriber.subscribe(CHANNEL_CHANGED, CHANNEL_OFFER, (err) => {
    if (err) logger.error({ err }, "redis ride bridge subscribe failed");
  });

  subscriber.on("message", (channel, message) => {
    if (channel === CHANNEL_CHANGED) {
      const event = parseJson<RideChangedEvent>(message);
      if (event?.rideId && event.phase) ingestRideChanged(event);
      return;
    }
    if (channel === CHANNEL_OFFER) {
      const event = parseJson<RideOfferEvent>(message);
      if (event?.driverId && event.offer) ingestRideOffer(event);
    }
  });

  return () => {
    unsubChanged();
    unsubOffer();
    void subscriber.quit();
  };
}
