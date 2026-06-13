/**
 * Shared SGR / coast corridor (Phase 1–4).
 * @see docs/SHARED_RIDES_API.md — integrator guide
 * @see src/schemas/shared-rides.schema.ts — Zod + OpenAPI (`/api/docs` tag "Shared rides")
 */
import { Router } from "express";
import type { Request } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  CorridorLocationSlugParamsSchema,
  CreateSharedDepartureBookingSchema,
  CreateTripRequestSchema,
  UpdateTripRequestSchema,
  DepartureIdParamsSchema,
  DepartureSeatNumberParamsSchema,
  DeparturesSearchQuerySchema,
  DriverTripRequestsQuerySchema,
  PublishSharedDepartureSchema,
  ReleaseDepartureSeatsSchema,
  ReserveDepartureSeatsSchema,
  ResolveCorridorLocationSchema,
  ScheduleSlotsQuerySchema,
  SuggestionsQuerySchema,
  TripRequestIdParamsSchema,
  UpdateDepartureLocationSchema,
  UpdateDepartureStatusSchema,
} from "../schemas/shared-rides.schema.js";
import {
  joinTripRequest,
  listDriverTripRequests,
  publishDeparture,
} from "../services/shared-rides/driver-supply.service.js";
import {
  getDriverDepartureDetail,
  listDriverDepartures,
  updateDriverDepartureStatus,
} from "../services/shared-rides/driver-departure.service.js";
import { updateDepartureDriverLocation } from "../services/shared-rides/departure-location.service.js";
import {
  createSharedDepartureBooking,
  listMySharedBookings,
} from "../services/shared-rides/departure-booking.service.js";
import {
  getDepartureDetail,
  releaseDepartureSeats,
  reserveDepartureSeats,
} from "../services/shared-rides/departure-seats.service.js";
import {
  getCorridorLocationBySlug,
  getSuggestions,
  listCorridorLocations,
  listScheduleSlots,
  resolveCorridorLocationFromGps,
  searchDepartures,
} from "../services/shared-rides/catalog.service.js";
import {
  cancelTripRequest,
  createTripRequest,
  listMyTripRequests,
  updateTripRequest,
} from "../services/shared-rides/trip-request.service.js";
import { createCallInBooking } from "../services/shared-rides/call-in-booking.service.js";
import {
  driverMarkSeatPaidCash,
  driverSeatPayInvite,
} from "../services/shared-rides/driver-seat-payment.service.js";
import { getPayInviteSummary, payViaInvite } from "../services/shared-rides/guest-pay.service.js";
import {
  CallInBookingSchema,
  PayInviteParamsSchema,
  PayInvitePaySchema,
} from "../schemas/shared-rides.schema.js";

const router: Router = Router();

router.get(
  "/pay-invites/:token",
  asyncHandler(async (req, res) => {
    const { token } = PayInviteParamsSchema.parse(req.params);
    res.status(200).json(await getPayInviteSummary(token));
  }),
);

router.post(
  "/pay-invites/:token/pay",
  asyncHandler(async (req, res) => {
    const { token } = PayInviteParamsSchema.parse(req.params);
    const body = PayInvitePaySchema.parse(req.body ?? {});
    res.status(200).json(await payViaInvite(token, body));
  }),
);

router.use(requireAuth);

router.get(
  "/corridor-locations",
  asyncHandler(async (_req, res) => {
    const locations = await listCorridorLocations();
    res.status(200).json({ locations });
  }),
);

router.post(
  "/corridor-locations/resolve",
  asyncHandler(async (req, res) => {
    const body = ResolveCorridorLocationSchema.parse(req.body);
    const result = await resolveCorridorLocationFromGps(body.lat, body.lng);
    res.status(200).json(result);
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

function passengerOrThrow(req: Request): Express.UserContext {
  if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
  if (req.user.role !== "passenger") {
    throw new AppError("FORBIDDEN", 403, "Only passengers can create shared trip requests.");
  }
  return req.user;
}

function driverOrThrow(req: Request): Express.UserContext {
  if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
  if (req.user.role !== "driver") {
    throw new AppError("FORBIDDEN", 403, "Only drivers can access this shared rides endpoint.");
  }
  return req.user;
}

router.post(
  "/trip-requests",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = passengerOrThrow(req);
    const body = CreateTripRequestSchema.parse(req.body);
    const result = await createTripRequest(user.id, body);
    res.status(201).json(result);
  }),
);

router.get(
  "/trip-requests/mine",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = passengerOrThrow(req);
    const result = await listMyTripRequests(user.id);
    res.status(200).json(result);
  }),
);

router.patch(
  "/trip-requests/:tripRequestId",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = passengerOrThrow(req);
    const { tripRequestId } = TripRequestIdParamsSchema.parse(req.params);
    const body = UpdateTripRequestSchema.parse(req.body);
    const result = await updateTripRequest(user.id, tripRequestId, body);
    res.status(200).json(result);
  }),
);

router.post(
  "/trip-requests/:tripRequestId/cancel",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = passengerOrThrow(req);
    const { tripRequestId } = TripRequestIdParamsSchema.parse(req.params);
    const result = await cancelTripRequest(user.id, tripRequestId);
    res.status(200).json(result);
  }),
);

router.get(
  "/trip-requests",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    driverOrThrow(req);
    const query = DriverTripRequestsQuerySchema.parse(req.query);
    const result = await listDriverTripRequests(query);
    res.status(200).json(result);
  }),
);

router.post(
  "/trip-requests/:tripRequestId/join",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const { tripRequestId } = TripRequestIdParamsSchema.parse(req.params);
    const result = await joinTripRequest(user.id, tripRequestId);
    res.status(200).json(result);
  }),
);

router.post(
  "/departures",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const body = PublishSharedDepartureSchema.parse(req.body);
    const result = await publishDeparture(user.id, body);
    res.status(201).json(result);
  }),
);

router.get(
  "/departures/mine",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const result = await listDriverDepartures(user.id);
    res.status(200).json(result);
  }),
);

router.get(
  "/departures/:departureId",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
    const { departureId } = DepartureIdParamsSchema.parse(req.params);
    if (req.user.role === "driver") {
      const result = await getDriverDepartureDetail(req.user.id, departureId);
      res.status(200).json(result);
      return;
    }
    if (req.user.role === "passenger") {
      const result = await getDepartureDetail(departureId, req.user.id);
      res.status(200).json(result);
      return;
    }
    throw new AppError("FORBIDDEN", 403, "Passengers and drivers only.");
  }),
);

router.patch(
  "/departures/:departureId/status",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const { departureId } = DepartureIdParamsSchema.parse(req.params);
    const body = UpdateDepartureStatusSchema.parse(req.body);
    const result = await updateDriverDepartureStatus(user.id, departureId, body.status);
    res.status(200).json(result);
  }),
);

router.patch(
  "/departures/:departureId/location",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const { departureId } = DepartureIdParamsSchema.parse(req.params);
    const body = UpdateDepartureLocationSchema.parse(req.body);
    const result = await updateDepartureDriverLocation(
      user.id,
      departureId,
      body.lat,
      body.lng,
    );
    res.status(200).json(result);
  }),
);

router.post(
  "/departures/:departureId/seats/reserve",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = passengerOrThrow(req);
    const { departureId } = DepartureIdParamsSchema.parse(req.params);
    const body = ReserveDepartureSeatsSchema.parse(req.body);
    const result = await reserveDepartureSeats(
      departureId,
      user.id,
      body.seatNumbers,
      body.pickup,
    );
    res.status(200).json(result);
  }),
);

router.post(
  "/departures/:departureId/seats/release",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = passengerOrThrow(req);
    const { departureId } = DepartureIdParamsSchema.parse(req.params);
    const body = ReleaseDepartureSeatsSchema.parse(req.body ?? {});
    const result = await releaseDepartureSeats(departureId, user.id, body.seatNumbers);
    res.status(200).json(result);
  }),
);

router.get(
  "/bookings/mine",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = passengerOrThrow(req);
    res.status(200).json(await listMySharedBookings(user.id));
  }),
);

router.post(
  "/departures/:departureId/bookings",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = passengerOrThrow(req);
    const { departureId } = DepartureIdParamsSchema.parse(req.params);
    const body = CreateSharedDepartureBookingSchema.parse(req.body);
    const result = await createSharedDepartureBooking(departureId, user.id, body);
    res.status(201).json(result);
  }),
);

router.post(
  "/departures/:departureId/call-in-bookings",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const { departureId } = DepartureIdParamsSchema.parse(req.params);
    const body = CallInBookingSchema.parse(req.body);
    const result = await createCallInBooking(user.id, departureId, body);
    res.status(201).json(result);
  }),
);

router.post(
  "/departures/:departureId/seats/:seatNumber/pay-invite",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const { departureId, seatNumber } = DepartureSeatNumberParamsSchema.parse(req.params);
    const result = await driverSeatPayInvite(user.id, departureId, seatNumber);
    res.status(200).json(result);
  }),
);

router.post(
  "/departures/:departureId/seats/:seatNumber/mark-paid-cash",
  requireRole("driver"),
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const { departureId, seatNumber } = DepartureSeatNumberParamsSchema.parse(req.params);
    const result = await driverMarkSeatPaidCash(user.id, departureId, seatNumber);
    res.status(200).json(result);
  }),
);

export default router;
