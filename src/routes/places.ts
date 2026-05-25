import { Router } from "express";
import { asyncHandler } from "../lib/errors.js";
import { rateLimit, requestIp } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  PlacesAutocompleteBodySchema,
  PlacesDetailsQuerySchema,
  PlacesReverseQuerySchema,
} from "../schemas/places.schema.js";
import {
  autocompletePlaces,
  getPlaceDetails,
  reversePlaceFromCatalog,
} from "../services/places.service.js";

const router: Router = Router();

router.use(requireAuth);

router.get(
  "/reverse",
  rateLimit({
    prefix: "places:reverse:ip",
    max: 30,
    windowMs: 60_000,
    identifier: (req) => requestIp(req),
  }),
  asyncHandler(async (req, res) => {
    const query = PlacesReverseQuerySchema.parse(req.query);
    res.status(200).json({
      place: reversePlaceFromCatalog(query.lat, query.lng),
    });
  }),
);

router.post(
  "/autocomplete",
  rateLimit({
    prefix: "places:autocomplete:ip",
    max: 60,
    windowMs: 60_000,
    identifier: (req) => requestIp(req),
  }),
  asyncHandler(async (req, res) => {
    const body = PlacesAutocompleteBodySchema.parse(req.body);
    const suggestions = await autocompletePlaces({
      input: body.input,
      sessionToken: body.sessionToken,
      origin: body.origin ?? null,
    });
    res.status(200).json({ suggestions });
  }),
);

router.get(
  "/:placeId",
  rateLimit({
    prefix: "places:details:ip",
    max: 60,
    windowMs: 60_000,
    identifier: (req) => requestIp(req),
  }),
  asyncHandler(async (req, res) => {
    const query = PlacesDetailsQuerySchema.parse(req.query);
    const place = await getPlaceDetails({
      placeId: req.params.placeId,
      sessionToken: query.sessionToken,
    });
    res.status(200).json({ place });
  }),
);

export default router;
