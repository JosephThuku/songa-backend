import { Router } from "express";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  AdminBookingQuerySchema,
  AdminDriverQuerySchema,
  AdminPatchUserSchema,
  AdminRideQuerySchema,
  AdminUpdateDriverStatusSchema,
  AdminUserQuerySchema,
  AdminWalletQuerySchema,
} from "../schemas/admin.schema.js";
import {
  adminDeactivateUser,
  adminGetBooking,
  adminGetDriver,
  adminGetPassenger,
  adminGetRide,
  adminGetUser,
  adminListBookings,
  adminListCashouts,
  adminListDrivers,
  adminListPassengers,
  adminListRides,
  adminListUsers,
  adminListWalletTransactions,
  adminPatchUser,
  adminUpdateDriverStatus,
} from "../services/admin.service.js";
import { AppError } from "../lib/errors.js";

const router: Router = Router();

router.use(requireAuth);
router.use(requireRole("admin"));

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const query = AdminUserQuerySchema.parse(req.query);
    res.json(await adminListUsers(query));
  }),
);

router.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    res.json(await adminGetUser(String(req.params.id)));
  }),
);

router.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const body = AdminPatchUserSchema.parse(req.body);
    res.json(await adminPatchUser(req.user.id, String(req.params.id), body));
  }),
);

router.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    res.json(await adminDeactivateUser(req.user.id, String(req.params.id)));
  }),
);

router.get(
  "/passengers",
  asyncHandler(async (req, res) => {
    const query = AdminUserQuerySchema.parse(req.query);
    res.json(await adminListPassengers(query));
  }),
);

router.get(
  "/passengers/:id",
  asyncHandler(async (req, res) => {
    res.json(await adminGetPassenger(String(req.params.id)));
  }),
);

router.get(
  "/drivers",
  asyncHandler(async (req, res) => {
    const query = AdminDriverQuerySchema.parse(req.query);
    res.json(await adminListDrivers(query));
  }),
);

router.get(
  "/drivers/:id",
  asyncHandler(async (req, res) => {
    res.json(await adminGetDriver(String(req.params.id)));
  }),
);

router.patch(
  "/drivers/:id/status",
  asyncHandler(async (req, res) => {
    const body = AdminUpdateDriverStatusSchema.parse(req.body);
    res.json(await adminUpdateDriverStatus(String(req.params.id), body));
  }),
);

router.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const query = AdminBookingQuerySchema.parse(req.query);
    res.json(await adminListBookings(query));
  }),
);

router.get(
  "/bookings/:id",
  asyncHandler(async (req, res) => {
    res.json(await adminGetBooking(String(req.params.id)));
  }),
);

router.get(
  "/rides",
  asyncHandler(async (req, res) => {
    const query = AdminRideQuerySchema.parse(req.query);
    res.json(await adminListRides(query));
  }),
);

router.get(
  "/rides/:id",
  asyncHandler(async (req, res) => {
    res.json(await adminGetRide(String(req.params.id)));
  }),
);

router.get(
  "/wallet-transactions",
  asyncHandler(async (req, res) => {
    const query = AdminWalletQuerySchema.parse(req.query);
    res.json(await adminListWalletTransactions(query));
  }),
);

router.get(
  "/cashouts",
  asyncHandler(async (req, res) => {
    const query = AdminWalletQuerySchema.omit({ type: true }).parse(req.query);
    res.json(await adminListCashouts(query));
  }),
);

export default router;
