/**
 * Admin catalog for shared SGR corridor (zones + timetable slots).
 * Requires JWT session with `role: admin` (same auth as passenger/driver).
 */
import { Router } from "express";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  AdminCorridorLocationQuerySchema,
  AdminCreateCorridorLocationSchema,
  AdminCreateSgrScheduleSlotSchema,
  AdminSgrScheduleSlotQuerySchema,
  AdminUpdateCorridorLocationSchema,
  AdminUpdateSgrScheduleSlotSchema,
} from "../schemas/shared-rides-admin.schema.js";
import {
  adminCreateCorridorLocation,
  adminCreateSgrScheduleSlot,
  adminDeactivateCorridorLocation,
  adminDeactivateSgrScheduleSlot,
  adminGetCorridorLocation,
  adminGetSgrScheduleSlot,
  adminListCorridorLocations,
  adminListSgrScheduleSlots,
  adminUpdateCorridorLocation,
  adminUpdateSgrScheduleSlot,
} from "../services/shared-rides/admin-catalog.service.js";

const router: Router = Router();

router.use(requireAuth);
router.use(requireRole("admin"));

router.get(
  "/corridor-locations",
  asyncHandler(async (req, res) => {
    const query = AdminCorridorLocationQuerySchema.parse(req.query);
    res.json(await adminListCorridorLocations(query));
  }),
);

router.get(
  "/corridor-locations/:id",
  asyncHandler(async (req, res) => {
    res.json(await adminGetCorridorLocation(String(req.params.id)));
  }),
);

router.post(
  "/corridor-locations",
  asyncHandler(async (req, res) => {
    const body = AdminCreateCorridorLocationSchema.parse(req.body);
    const result = await adminCreateCorridorLocation(body);
    res.status(201).json(result);
  }),
);

router.patch(
  "/corridor-locations/:id",
  asyncHandler(async (req, res) => {
    const body = AdminUpdateCorridorLocationSchema.parse(req.body);
    const result = await adminUpdateCorridorLocation(String(req.params.id), body);
    res.json(result);
  }),
);

router.delete(
  "/corridor-locations/:id",
  asyncHandler(async (req, res) => {
    const result = await adminDeactivateCorridorLocation(String(req.params.id));
    res.json(result);
  }),
);

router.get(
  "/sgr-schedule-slots",
  asyncHandler(async (req, res) => {
    const query = AdminSgrScheduleSlotQuerySchema.parse(req.query);
    res.json(await adminListSgrScheduleSlots(query));
  }),
);

router.get(
  "/sgr-schedule-slots/:id",
  asyncHandler(async (req, res) => {
    res.json(await adminGetSgrScheduleSlot(String(req.params.id)));
  }),
);

router.post(
  "/sgr-schedule-slots",
  asyncHandler(async (req, res) => {
    const body = AdminCreateSgrScheduleSlotSchema.parse(req.body);
    const result = await adminCreateSgrScheduleSlot(body);
    res.status(201).json(result);
  }),
);

router.patch(
  "/sgr-schedule-slots/:id",
  asyncHandler(async (req, res) => {
    const body = AdminUpdateSgrScheduleSlotSchema.parse(req.body);
    const result = await adminUpdateSgrScheduleSlot(String(req.params.id), body);
    res.json(result);
  }),
);

router.delete(
  "/sgr-schedule-slots/:id",
  asyncHandler(async (req, res) => {
    const result = await adminDeactivateSgrScheduleSlot(String(req.params.id));
    res.json(result);
  }),
);

export default router;
