// NEW — root router; mounts feature routers.

import { Router } from "express";
import authRouter from "./auth.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "songa-backend" });
});

router.use("/auth", authRouter);

export default router;
