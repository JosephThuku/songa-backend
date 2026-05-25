// Root API router; mounts feature routers.

import { Router } from "express";
import authRouter from "./auth.js";
import bookingsRouter from "./bookings.js";
import devicesRouter from "./devices.js";
import driversRouter from "./drivers.js";
import docsRouter from "./docs.js";
import notificationsRouter from "./notifications.js";
import placesRouter from "./places.js";
import ridesRouter from "./rides.js";

const router: Router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "songa-backend" });
});

router.use("/auth", authRouter);
router.use("/bookings", bookingsRouter);
router.use("/rides", ridesRouter);
router.use("/drivers", driversRouter);
router.use("/notifications", notificationsRouter);
router.use("/devices", devicesRouter);
router.use("/places", placesRouter);

// Docs surface — Swagger UI at /api/docs, raw spec at /api/openapi.json.
router.use("/", docsRouter);

export default router;
