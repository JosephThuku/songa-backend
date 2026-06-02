// Human-readable request lines in development (JSON pino logs are easy to miss).

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Env } from "../config/env.js";

export function devRequestLog(env: Env): RequestHandler {
  if (env.NODE_ENV !== "development") {
    return (_req, _res, next) => next();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const target = `${req.method} ${req.originalUrl}`;

    if (req.method === "OPTIONS") {
      console.log(
        `[http] → ${target}` +
          ` origin=${req.get("origin") ?? "-"}` +
          ` acrm=${req.get("access-control-request-method") ?? "-"}` +
          ` acrh=${req.get("access-control-request-headers") ?? "-"}`,
      );
    } else {
      console.log(`[http] → ${target} origin=${req.get("origin") ?? "-"}`);
    }

    res.on("finish", () => {
      console.log(`[http] ← ${res.statusCode} ${target} ${Date.now() - start}ms`);
    });

    next();
  };
}
