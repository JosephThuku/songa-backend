import { Router } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import { CreateBookingRequestSchema, PayBookingRequestSchema } from "../schemas/booking.schema.js";
import { createBooking, getBooking, startPayment } from "../services/booking.service.js";

const router: Router = Router();

router.use(requireAuth);
router.use(requireRole("passenger"));

router.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const parsed = CreateBookingRequestSchema.parse(req.body);
    res.status(201).json({ booking: await createBooking({ ...parsed, passengerId: req.user.id }) });
  }),
);

router.post(
  "/:id/pay",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const parsed = PayBookingRequestSchema.parse(req.body ?? {});
    res.status(200).json(await startPayment(req.params.id, req.user.id, parsed.provider));
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    res.status(200).json(await getBooking(req.params.id, req.user.id));
  }),
);

export default router;

