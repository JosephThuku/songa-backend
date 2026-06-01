// NEW — requireRole middleware. Used after requireAuth.

import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";

export function requireRole(
  ...roles: Array<"passenger" | "driver" | "admin">
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError("UNAUTHORIZED", 401, "Authentication required."));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError("FORBIDDEN", 403, `Role '${req.user.role}' is not permitted.`),
      );
    }
    next();
  };
}
