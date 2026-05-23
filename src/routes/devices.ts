import { Router } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import { RegisterDeviceRequestSchema } from "../schemas/notification.schema.js";
import { registerDevice } from "../services/notification.service.js";

const router: Router = Router();

router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const parsed = RegisterDeviceRequestSchema.parse(req.body);
    res.status(200).json(await registerDevice(req.user.id, parsed));
  }),
);

export default router;

