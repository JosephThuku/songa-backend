// Health endpoint OpenAPI registration. Schema itself lives in common.schema.ts.

import { registry } from "./openapi-registry.js";
import { HealthResponseSchema } from "./common.schema.js";

registry.registerPath({
  method: "get",
  path: "/api/health",
  tags: ["Health"],
  summary: "Liveness probe",
  description: "Cheap endpoint for load balancers and uptime monitors. Does not touch the DB or Redis.",
  responses: {
    200: {
      description: "Service is up.",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});
