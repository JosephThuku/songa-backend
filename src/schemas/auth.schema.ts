// Auth endpoint request/response schemas + OpenAPI path registrations.
// The routes import the request schemas for runtime validation; the registrar
// at the bottom of this file describes the endpoints to OpenAPI.

import { z } from "zod";
import { registry } from "./openapi-registry.js";
import { ErrorEnvelopeSchema, UserSchema } from "./common.schema.js";

// ---------------- Request schemas (used by routes/auth.ts for validation) ----------------

export const roleSchema = z
  .enum(["passenger", "driver"], { errorMap: () => ({ message: "role must be 'passenger' or 'driver'" }) })
  .openapi({ example: "passenger" });

export const SendOtpRequestSchema = registry.register(
  "SendOtpRequest",
  z
    .object({
      phone: z
        .string({ required_error: "phone is required" })
        .min(1, "phone is required")
        .openapi({ example: "+254712000001", description: "E.164. Local Kenyan formats accepted too." }),
      role: roleSchema,
    })
    .strict(),
);

export const VerifyOtpRequestSchema = registry.register(
  "VerifyOtpRequest",
  z
    .object({
      phone: z
        .string({ required_error: "phone is required" })
        .min(1, "phone is required")
        .openapi({ example: "+254712000001" }),
      role: roleSchema,
      code: z
        .string({ required_error: "code is required" })
        .regex(/^\d{4,6}$/, "code must be 4–6 digits")
        .openapi({ example: "123456" }),
    })
    .strict(),
);

// ---------------- Response schemas ----------------

export const SendOtpResponseSchema = registry.register(
  "SendOtpResponse",
  z.object({
    ok: z.literal(true),
    expiresInSeconds: z.number().int().openapi({ example: 300 }),
    devCode: z
      .string()
      .optional()
      .openapi({
        example: "123456",
        description:
          "Only present in non-production AND when the request includes `x-dev-show-otp: 1`. Never in production.",
      }),
  }),
);

export const VerifyOtpResponseSchema = registry.register(
  "VerifyOtpResponse",
  z.object({
    sessionToken: z
      .string()
      .openapi({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", description: "JWT, 30-day expiry, HS256." }),
    user: UserSchema,
  }),
);

export const MeResponseSchema = registry.register("MeResponse", z.object({ user: UserSchema }));

export const LogoutResponseSchema = registry.register("LogoutResponse", z.object({ ok: z.literal(true) }));

// ---------------- Path registrations ----------------

registry.registerPath({
  method: "post",
  path: "/api/auth/otp/send",
  tags: ["Auth"],
  summary: "Send a one-time password to the supplied phone",
  description:
    "Generates a 6-digit code, stores its SHA-256 hash in Redis for 300s, and (in production) dispatches it via SMS. " +
    "In non-production with `x-dev-show-otp: 1` the code is returned in the response for testing.\n\n" +
    "Rate limits: 10 sends per IP per minute, 3 per phone per 15 minutes.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: SendOtpRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "OTP issued.",
      content: { "application/json": { schema: SendOtpResponseSchema } },
    },
    400: {
      description: "Invalid phone or role.",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    429: {
      description: "Rate-limited.",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/otp/verify",
  tags: ["Auth"],
  summary: "Verify the OTP and start a session",
  description:
    "On success, issues a JWT session token (30-day expiry) and creates a server-side `Session` row for revocation. " +
    "Web clients (browser User-Agent) also receive an `HttpOnly; SameSite=Lax` cookie named `songa_session`. " +
    "The response is byte-equivalent to backend-requirements.md §2.3.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: VerifyOtpRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Session created.",
      headers: {
        "Set-Cookie": {
          description: "Only set for browser User-Agents.",
          schema: { type: "string", example: "songa_session=<jwt>; HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/" },
        },
      },
      content: { "application/json": { schema: VerifyOtpResponseSchema } },
    },
    400: {
      description: "Invalid input.",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    401: {
      description: "Wrong, expired, or already-consumed code. The error does not leak whether the phone exists.",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
    429: {
      description: "Too many verify attempts. Request a new code.",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/logout",
  tags: ["Auth"],
  summary: "Revoke the current session",
  description: "Sets `Session.revokedAt = now()` server-side and clears the `songa_session` cookie if present.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: {
      description: "Session revoked.",
      content: { "application/json": { schema: LogoutResponseSchema } },
    },
    401: {
      description: "Missing or already-revoked session.",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/auth/me",
  tags: ["Auth"],
  summary: "Get the authenticated user",
  description:
    "Returns the user object in the §2.4 shape. Drivers also get a `driverProfile` sub-object. " +
    "Returns 401 if the JWT is missing, invalid, expired, or its session row has been revoked.",
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: {
      description: "Authenticated user.",
      content: { "application/json": { schema: MeResponseSchema } },
    },
    401: {
      description: "Unauthorized.",
      content: { "application/json": { schema: ErrorEnvelopeSchema } },
    },
  },
});
