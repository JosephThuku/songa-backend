/**
 * Shared SGR / coast corridor (Phase 1).
 * @see docs/SHARED_RIDES_API.md — integrator guide
 * @see src/schemas/shared-rides.schema.ts — Zod + OpenAPI (`/api/docs` tag "Shared rides")
 */
import { Router } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  CorridorLocationSlugParamsSchema,
  DeparturesSearchQuerySchema,
  ScheduleSlotsQuerySchema,
  SuggestionsQuerySchema,
} from "../schemas/shared-rides.schema.js";
import {
  getCorridorLocationBySlug,
  getSuggestions,
  listCorridorLocations,
  listScheduleSlots,
  searchDepartures,
} from "../services/shared-rides/catalog.service.js";

const router: Router = Router();

router.use(requireAuth);

router.get(
  "/corridor-locations",
  asyncHandler(async (_req, res) => {
    const locations = await listCorridorLocations();
    res.status(200).json({ locations });
  }),
);

router.get(
  "/corridor-locations/:slug",
  asyncHandler(async (req, res) => {
    const { slug } = CorridorLocationSlugParamsSchema.parse(req.params);
    const location = await getCorridorLocationBySlug(slug);
    if (!location) {
      throw new AppError("CORRIDOR_LOCATION_NOT_FOUND", 404, "Corridor location not found.");
    }
    res.status(200).json({ location });
  }),
);

router.get(
  "/sgr-schedule-slots",
  asyncHandler(async (req, res) => {
    const query = ScheduleSlotsQuerySchema.parse(req.query);
    const slots = await listScheduleSlots(query);
    res.status(200).json({ slots });
  }),
);

router.get(
  "/suggestions",
  asyncHandler(async (req, res) => {
    const query = SuggestionsQuerySchema.parse(req.query);
    const result = await getSuggestions(query);
    res.status(200).json(result);
  }),
);

router.get(
  "/departures/search",
  asyncHandler(async (req, res) => {
    const query = DeparturesSearchQuerySchema.parse(req.query);
    const result = await searchDepartures(query);
    res.status(200).json(result);
  }),
);

export default router;
