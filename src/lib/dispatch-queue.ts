import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { logger } from "./logger.js";
import { OFFER_TTL_MS } from "./offer-timeout.js";

const QUEUE_NAME = "ride-offer-timeout";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function bullConnection(): ConnectionOptions {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required for BullMQ");
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: bullConnection() });
  }
  return queue;
}

export async function enqueueOfferTimeout(rideId: string): Promise<void> {
  await getQueue().add(
    "timeout",
    { rideId },
    {
      delay: OFFER_TTL_MS,
      jobId: `offer-timeout:${rideId}`,
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}

export async function cancelOfferTimeoutJobs(rideId: string): Promise<void> {
  const job = await getQueue().getJob(`offer-timeout:${rideId}`);
  if (job) await job.remove();
}

export function startDispatchWorker(): () => void {
  if (worker) return () => worker?.close();
  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ rideId: string }>) => {
      const rideId = job.data.rideId;
      const { redispatchRideIfPending } = await import("../services/ride.service.js");
      await redispatchRideIfPending(rideId);
    },
    { connection: bullConnection() },
  );
  worker.on("failed", (job: Job<{ rideId: string }> | undefined, err: Error) => {
    logger.warn({ err, jobId: job?.id, rideId: job?.data?.rideId }, "dispatch worker job failed");
  });
  return () => {
    void worker?.close();
    worker = null;
  };
}
