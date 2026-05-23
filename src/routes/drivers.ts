import { Router } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  DriverLocationRequestSchema,
  DriverOnlineRequestSchema,
  NearbyDriversQuerySchema,
} from "../schemas/driver.schema.js";
import { getNearbyDrivers, setDriverOnline, updateDriverLocation } from "../services/driver.service.js";
import { cashout, getDriverWallet } from "../services/wallet.service.js";
import { CashoutRequestSchema } from "../schemas/wallet.schema.js";

const router: Router = Router();

function driverUser(req: Express.Request): Express.UserContext {
  if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
  if (req.user.role !== "driver") throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
  return req.user;
}

router.patch(
  "/me/online",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = driverUser(req);
    const parsed = DriverOnlineRequestSchema.parse(req.body);
    res.status(200).json(await setDriverOnline(user.id, parsed.isOnline));
  }),
);

router.post(
  "/me/location",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = driverUser(req);
    const parsed = DriverLocationRequestSchema.parse(req.body);
    await updateDriverLocation(user.id, parsed);
    res.status(204).send();
  }),
);

router.get(
  "/me/wallet",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = driverUser(req);
    res.status(200).json(await getDriverWallet(user.id));
  }),
);

router.post(
  "/me/wallet/cashout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = driverUser(req);
    const parsed = CashoutRequestSchema.parse(req.body);
    res.status(200).json(await cashout(user.id, parsed));
  }),
);

router.get(
  "/nearby",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = NearbyDriversQuerySchema.parse(req.query);
    res.status(200).json({ drivers: await getNearbyDrivers(parsed) });
  }),
);

export default router;
