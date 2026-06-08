// NEW — AppError + asyncHandler + error middleware.

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";
import { mapPrismaError } from "./prisma-errors.js";

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asyncHandler<
  P = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  Q = Record<string, string>,
>(
  fn: (
    req: Request<P, ResBody, ReqBody, Q>,
    res: Response<ResBody>,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler<P, ResBody, ReqBody, Q> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  // next must remain in the signature so Express recognizes this as an error handler
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
      },
    };
    if (err.details !== undefined) body.error.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: "INVALID_INPUT",
        message: "Invalid input.",
        details: { issues: err.issues },
      },
    };
    res.status(400).json(body);
    return;
  }

  const prismaError = mapPrismaError(err);
  if (prismaError) {
    const body: ErrorBody = {
      error: {
        code: prismaError.code,
        message: prismaError.message,
      },
    };
    if (prismaError.details !== undefined) body.error.details = prismaError.details;
    res.status(prismaError.status).json(body);
    return;
  }

  const isProd = process.env.NODE_ENV === "production";
  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  const body: ErrorBody = {
    error: {
      code: "INTERNAL_ERROR",
      message: isProd ? "Internal server error." : (err as Error)?.message ?? "Internal server error.",
    },
  };
  res.status(500).json(body);
}

export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found.`,
    },
  });
}
