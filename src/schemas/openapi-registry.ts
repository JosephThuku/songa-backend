// Singleton OpenAPI registry. Every schema and path registers itself here, and
// src/lib/openapi.ts builds the final document from this registry.
//
// Call `extendZodWithOpenApi(z)` once, at module load, so `.openapi({...})` is
// available on every Zod schema in the codebase.

import { OpenAPIRegistry, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Bearer-token JWT for native clients.
export const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "JWT issued by `POST /api/auth/login`. Mobile clients send `Authorization: Bearer <token>`.",
});

// HttpOnly cookie session for web clients (set automatically on `/login` when UA is a browser).
export const cookieAuth = registry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "songa_session",
  description: "Set automatically by `POST /api/auth/login` when the User-Agent is a browser. HttpOnly + SameSite=Lax.",
});
