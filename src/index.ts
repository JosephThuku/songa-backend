// Server entrypoint. Builds the express app, wraps it in a raw HTTP server so
// Socket.io can attach to the same port, then starts listening.

import "dotenv/config";
import { createServer } from "node:http";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { assertPrismaClientCurrent } from "./lib/ensure-prisma-client.js";
import { startDispatchWorker } from "./lib/dispatch-queue.js";
import { startRideEventBridge } from "./lib/ride-event-bridge.js";
import { shouldUseDummyPlaces } from "./lib/dummy-places.js";
import {
  getGooglePlacesApiKey,
  googlePlacesKeyEnvHint,
} from "./lib/google-places-key.js";
import { attachSocketIo } from "./lib/socket.js";

async function main(): Promise<void> {
  assertPrismaClientCurrent();
  const env = loadEnv();

  if (shouldUseDummyPlaces()) {
    logger.info(
      "Places autocomplete: using data/dummy-places.json (set GOOGLE_PLACES_API_KEY for Google or USE_DUMMY_PLACES=true for dummy data)",
    );
  } else if (!getGooglePlacesApiKey()) {
    logger.warn(googlePlacesKeyEnvHint());
  } else {
    logger.info("Places autocomplete: Google Places API (New)");
  }
  const app = buildApp({ env });
  const httpServer = createServer(app);
  const stopRideBridge = startRideEventBridge();
  const stopDispatchWorker = process.env.REDIS_URL
    ? startDispatchWorker()
    : () => undefined;
  const io = attachSocketIo({ server: httpServer, env });

  httpServer.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      "songa-backend listening",
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    stopRideBridge();
    stopDispatchWorker();
    io.close(() => undefined);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
