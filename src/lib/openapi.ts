// Builds the OpenAPI 3.1 document for the Songa backend. Reads from the shared
// registry that every schema and route has populated, plus side-effect-imports
// the path-registering modules so endpoints actually show up.

import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { registry } from "../schemas/openapi-registry.js";

// Side-effect imports — each module registers its paths + schemas on load.
import "../schemas/common.schema.js";
import "../schemas/health.schema.js";
import "../schemas/auth.schema.js";

const VERSION = "0.1.0";

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31["generateDocument"]> {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Songa API",
      version: VERSION,
      description:
        "Songa is a Kenyan ride-hailing platform (passenger + driver, Uber-style flows). " +
        "This API powers the React Native mobile app. The canonical contract spec lives in the mobile repo " +
        "at `docs/backend-requirements.md`.\n\n" +
        "**Auth**: most endpoints require a JWT issued by `POST /api/auth/otp/verify`. Native clients " +
        "send `Authorization: Bearer <token>`; browser clients are authenticated automatically via the " +
        "`songa_session` HttpOnly cookie.",
      contact: { name: "Songa engineering" },
    },
    servers: [
      { url: "http://localhost:4000", description: "Local dev" },
      { url: "https://api.songa.app", description: "Production (placeholder)" },
    ],
    tags: [
      { name: "Health", description: "Service liveness." },
      { name: "Auth", description: "Phone + OTP authentication, JWT sessions." },
    ],
  });
}
