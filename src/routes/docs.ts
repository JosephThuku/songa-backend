// Serves the OpenAPI JSON at /openapi.json and the interactive Swagger UI at /docs.
// Mounted under /api by the root router, so the public URLs are
// /api/openapi.json and /api/docs.

import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "../lib/openapi.js";

const router: Router = Router();

// Swagger UI relies on inline scripts/styles + data: fonts. Strip the CSP
// header (set by Helmet upstream) for the docs surface only.
router.use((_req, res, next) => {
  res.removeHeader("Content-Security-Policy");
  next();
});

// Build once at module load — registry is fully populated by then.
const document = buildOpenApiDocument();

router.get("/openapi.json", (_req, res) => {
  res.status(200).json(document);
});

// `swaggerUi.setup(...)` returns its own middleware; mount the assets first
// (CSS / JS) then the HTML handler.
router.use("/docs", swaggerUi.serve);
router.get(
  "/docs",
  swaggerUi.setup(document, {
    customSiteTitle: "Songa API",
    customCss: ".topbar { display: none }",
    swaggerOptions: {
      persistAuthorization: true,
      tryItOutEnabled: true,
    },
  }),
);

export default router;
