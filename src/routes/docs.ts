// Serves the OpenAPI JSON at /openapi.json and the interactive Swagger UI at /docs.
// Mounted under /api by the root router, so the public URLs are
// /api/openapi.json and /api/docs.

import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "../lib/openapi.js";

const router: Router = Router();

/** Public mount path (docs router is mounted at /api). */
const DOCS_BASE_PATH = "/api/docs/";

// Swagger UI relies on inline scripts/styles + data: fonts. Strip the CSP
// header (set by Helmet upstream) for the docs surface only.
router.use((_req, res, next) => {
  res.removeHeader("Content-Security-Policy");
  next();
});

// Build once at module load — registry is fully populated by then.
const document = buildOpenApiDocument();

const swaggerSetupOptions = {
  customSiteTitle: "Songa API",
  customCss: ".topbar { display: none }",
  swaggerOptions: {
    persistAuthorization: true,
    tryItOutEnabled: true,
  },
} as const;

const swaggerHtmlHandler = swaggerUi.setup(document, swaggerSetupOptions);

/** Register HTML before static assets so express.static does not 301 /docs → /docs/. */
function serveSwaggerHtml(
  _req: Parameters<typeof swaggerHtmlHandler>[0],
  res: Parameters<typeof swaggerHtmlHandler>[1],
  next: Parameters<typeof swaggerHtmlHandler>[2],
): void {
  const send = res.send.bind(res);
  res.send = (body: unknown) => {
    if (typeof body === "string" && body.includes("swagger-ui")) {
      const withBase = body.includes("<base ")
        ? body
        : body.replace("<head>", `<head>\n  <base href="${DOCS_BASE_PATH}">`);
      return send(withBase);
    }
    return send(body);
  };
  swaggerHtmlHandler(_req, res, next);
}

router.get("/openapi.json", (_req, res) => {
  res.status(200).json(document);
});

// HTML first (with and without trailing slash). Assets below.
router.get(["/docs", "/docs/"], serveSwaggerHtml);

// redirect: false — default static redirect breaks subpath deploys (Render, proxies).
router.use(
  "/docs",
  ...swaggerUi.serveWithOptions({
    redirect: false,
  }),
);

export default router;
