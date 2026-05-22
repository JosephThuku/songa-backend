// Root API router; mounts feature routers.

import { Router } from "express";
import authRouter from "./auth.js";
import docsRouter from "./docs.js";

const router: Router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "songa-backend" });
});

router.use("/auth", authRouter);

// Docs surface — Swagger UI at /api/docs, raw spec at /api/openapi.json.
router.use("/", docsRouter);

export default router;
