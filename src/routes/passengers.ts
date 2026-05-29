import { Router } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  CreateSavedPlaceSchema,
  UploadPassengerAvatarSchema,
  UpdatePassengerProfileSchema,
  UpdatePaymentMethodsSchema,
} from "../schemas/passenger.schema.js";
import {
  clearPassengerAvatar,
  createSavedPlace,
  deleteSavedPlace,
  getPassengerProfile,
  getSupportInfo,
  updatePassengerProfile,
  updatePaymentMethods,
  uploadPassengerAvatar,
} from "../services/passenger-profile.service.js";

const router: Router = Router();

router.use(requireAuth);
router.use(requireRole("passenger"));

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    res.status(200).json(await getPassengerProfile(req.user.id));
  }),
);

router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const body = UpdatePassengerProfileSchema.parse(req.body);
    res.status(200).json(await updatePassengerProfile(req.user.id, body));
  }),
);

router.post(
  "/me/avatar",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const body = UploadPassengerAvatarSchema.parse(req.body);
    const publicBaseUrl = `${req.protocol}://${req.get("host")}`;
    res.status(200).json(
      await uploadPassengerAvatar(req.user.id, body, publicBaseUrl),
    );
  }),
);

router.delete(
  "/me/avatar",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    res.status(200).json(await clearPassengerAvatar(req.user.id));
  }),
);

router.get(
  "/me/saved-places",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const profile = await getPassengerProfile(req.user.id);
    res.status(200).json({ savedPlaces: profile.savedPlaces });
  }),
);

router.post(
  "/me/saved-places",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const body = CreateSavedPlaceSchema.parse(req.body);
    const savedPlace = await createSavedPlace(req.user.id, body);
    res.status(201).json({ savedPlace });
  }),
);

router.delete(
  "/me/saved-places/:placeId",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    await deleteSavedPlace(req.user.id, req.params.placeId);
    res.status(200).json({ ok: true });
  }),
);

router.get(
  "/me/payment-methods",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const profile = await getPassengerProfile(req.user.id);
    res.status(200).json({ paymentMethods: profile.paymentMethods });
  }),
);

router.put(
  "/me/payment-methods",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const body = UpdatePaymentMethodsSchema.parse(req.body);
    const paymentMethods = await updatePaymentMethods(req.user.id, body);
    res.status(200).json({ paymentMethods });
  }),
);

router.get(
  "/support",
  asyncHandler(async (_req, res) => {
    res.status(200).json(getSupportInfo());
  }),
);

export default router;
