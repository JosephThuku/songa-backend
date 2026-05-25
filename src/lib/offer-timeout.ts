import { logger } from "./logger.js";

export const OFFER_TTL_MS = 15_000;

const inProcessTimers = new Map<string, ReturnType<typeof setTimeout>>();

let queueModule: typeof import("./dispatch-queue.js") | null = null;

async function loadQueueModule() {
  if (!queueModule) {
    queueModule = await import("./dispatch-queue.js");
  }
  return queueModule;
}

export function scheduleOfferTimeout(rideId: string): void {
  cancelOfferTimeout(rideId);
  if (process.env.REDIS_URL) {
    void loadQueueModule()
      .then((mod) => mod.enqueueOfferTimeout(rideId))
      .catch((err) => logger.warn({ err, rideId }, "bullmq offer timeout enqueue failed"));
    return;
  }

  const timer = setTimeout(() => {
    inProcessTimers.delete(rideId);
    void import("../services/ride.service.js")
      .then((mod) => mod.redispatchRideIfPending(rideId))
      .catch((err) => logger.warn({ err, rideId }, "in-process offer timeout redispatch failed"));
  }, OFFER_TTL_MS);
  timer.unref?.();
  inProcessTimers.set(rideId, timer);
}

export function cancelOfferTimeout(rideId: string): void {
  const timer = inProcessTimers.get(rideId);
  if (timer) {
    clearTimeout(timer);
    inProcessTimers.delete(rideId);
  }
  if (process.env.REDIS_URL) {
    void loadQueueModule()
      .then((mod) => mod.cancelOfferTimeoutJobs(rideId))
      .catch(() => undefined);
  }
}
