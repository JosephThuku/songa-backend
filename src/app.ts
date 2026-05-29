// NEW — Express app factory. Exported so tests can build the app without binding a port.

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import path from "node:path";
import { pinoHttp } from "pino-http";
import { corsOriginSetting, type Env } from "./config/env.js";
import { errorMiddleware, notFoundMiddleware } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import apiRouter from "./routes/index.js";

export interface BuildAppOptions {
  env: Env;
}

export function buildApp({ env }: BuildAppOptions): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: corsOriginSetting(env),
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-dev-show-otp",
        "ngrok-skip-browser-warning",
        "Idempotency-Key",
      ],
    }),
  );
  app.use(express.json({ limit: "3mb" }));
  app.use(cookieParser());
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Skip HTTP logging during tests to keep output clean.
  if (env.NODE_ENV !== "test") {
    app.use(pinoHttp({ logger }));
  }

  app.use("/api", apiRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
