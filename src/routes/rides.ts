import { Router } from "express";
import type { Request } from "express";
import { AppError, asyncHandler } from "../lib/errors.js";
import { withIdempotency } from "../lib/idempotency.js";
import { onRideChanged, onRideOffer, type RideChangedEvent, type RideOfferEvent } from "../lib/ride-events.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireRole } from "../middleware/require-role.js";
import {
  CancelRideRequestSchema,
  RateDriverRequestSchema,
  RequestRideRequestSchema,
  SearchRideRequestSchema,
} from "../schemas/ride.schema.js";
import { searchRides } from "../services/ride-search.service.js";
import {
  acceptRide,
  cancelRide,
  completeRide,
  declineRide,
  getActiveRide,
  getRideById,
  markArrived,
  rateDriverForRide,
  requestRide,
  startRide,
} from "../services/ride.service.js";
import { getRideNavigation } from "../services/ride-navigation.service.js";

const router: Router = Router();

router.use(requireAuth);

function userOrThrow(req: Request): Express.UserContext {
  if (!req.user) throw new AppError("UNAUTHORIZED", 401, "Authentication required.");
  return req.user;
}

function driverOrThrow(req: Request): Express.UserContext {
  const user = userOrThrow(req);
  if (user.role !== "driver") throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
  return user;
}

router.post(
  "/search",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    userOrThrow(req);
    const parsed = SearchRideRequestSchema.parse(req.body);
    res.status(200).json(await searchRides(parsed));
  }),
);

router.post(
  "/request",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = userOrThrow(req);
    const parsed = RequestRideRequestSchema.parse(req.body);
    const result = await withIdempotency(req, "rides.request", async () => ({
      status: 201,
      body: { ride: await requestRide({ ...parsed, passengerId: user.id }, user) },
    }));
    res.status(result.status).json(result.body);
  }),
);

router.get(
  "/active",
  asyncHandler(async (req, res) => {
    const user = userOrThrow(req);
    res.status(200).json({ ride: await getActiveRide(user) });
  }),
);

router.get(
  "/active/stream",
  asyncHandler(async (req, res) => {
    const user = userOrThrow(req);
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let closed = false;
    const write = (payload: unknown) => {
      if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    write({ type: "ride.updated", ride: await getActiveRide(user) });

    const handleRideChanged = (event: RideChangedEvent) => {
      void (async () => {
        try {
          const ride = await getRideById(event.rideId, user);
          write({ type: "ride.updated", ride });
          if (event.phase === "trip_ended") {
            write({ type: "ride.ended", rideId: event.rideId, phase: event.phase });
          }
          if (event.phase === "cancelled") {
            write({ type: "ride.cancelled", rideId: event.rideId, phase: "cancelled" });
          }
        } catch (err) {
          if (err instanceof AppError && err.code === "RIDE_NOT_FOUND") return;
          req.log?.error?.({ err }, "ride stream event failed");
        }
      })();
    };

    const unsubscribe = onRideChanged(handleRideChanged);
    const unsubscribeOffers = onRideOffer((event: RideOfferEvent) => {
      if (user.role === "driver" && event.driverId === user.id) {
        write({ type: "ride.offer", offer: event.offer });
      }
    });
    const heartbeat = setInterval(() => {
      if (!closed) res.write(": heartbeat\n\n");
    }, 25_000);
    heartbeat.unref();

    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeOffers();
    });
  }),
);

router.get(
  "/:rideId",
  asyncHandler(async (req, res) => {
    const user = userOrThrow(req);
    res.status(200).json({ ride: await getRideById(req.params.rideId, user) });
  }),
);

router.get(
  "/:rideId/navigation",
  asyncHandler(async (req, res) => {
    const user = userOrThrow(req);
    if (user.role !== "passenger" && user.role !== "driver") {
      throw new AppError("FORBIDDEN", 403, "Navigation is not available for this role.");
    }
    res.status(200).json({
      navigation: await getRideNavigation(req.params.rideId, user.id, user.role),
    });
  }),
);

router.post(
  "/:rideId/cancel",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = userOrThrow(req);
    const parsed = CancelRideRequestSchema.parse(req.body);
    const ride = await cancelRide({ rideId: req.params.rideId, passengerId: user.id, ...parsed }, user);
    res.status(200).json({ ride });
  }),
);

router.post(
  "/:rideId/accept",
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    const result = await withIdempotency(req, "rides.accept", async () => ({
      status: 200,
      body: { ride: await acceptRide(req.params.rideId, user.id, user) },
    }));
    res.status(result.status).json(result.body);
  }),
);

router.post(
  "/:rideId/decline",
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    res.status(200).json(await declineRide(req.params.rideId, user.id));
  }),
);

router.post(
  "/:rideId/arrived",
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    res.status(200).json({ ride: await markArrived(req.params.rideId, user.id, user) });
  }),
);

router.post(
  "/:rideId/start",
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    res.status(200).json({ ride: await startRide(req.params.rideId, user.id, user) });
  }),
);

router.post(
  "/:rideId/complete",
  asyncHandler(async (req, res) => {
    const user = driverOrThrow(req);
    res.status(200).json({ ride: await completeRide(req.params.rideId, user.id, user) });
  }),
);

router.post(
  "/:rideId/rate",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const user = userOrThrow(req);
    const parsed = RateDriverRequestSchema.parse(req.body);
    res.status(200).json({
      ride: await rateDriverForRide(req.params.rideId, user.id, parsed.stars, user),
    });
  }),
);

export default router;
