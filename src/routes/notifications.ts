import { Router } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import { NotificationsQuerySchema } from "../schemas/notification.schema.js";
import { getNotifications } from "../services/notification.service.js";

const router: Router = Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const parsed = NotificationsQuerySchema.parse(req.query);
    res.status(200).json(await getNotifications(req.user.id, parsed.limit));
  }),
);

export default router;

