import { Router } from "express";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  AdminBookingQuerySchema,
  AdminDriverQuerySchema,
  AdminRideQuerySchema,
  AdminUpdateDriverStatusSchema,
  AdminUserQuerySchema,
  AdminWalletQuerySchema,
} from "../schemas/admin.schema.js";
import {
  adminGetBooking,
  adminGetDriver,
  adminGetRide,
  adminGetUser,
  adminListBookings,
  adminListCashouts,
  adminListDrivers,
  adminListRides,
  adminListUsers,
  adminListWalletTransactions,
  adminUpdateDriverStatus,
} from "../services/admin.service.js";

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
