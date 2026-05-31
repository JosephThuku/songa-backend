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

const passwordSchema = z
  .string({ required_error: "password is required" })
  .regex(/^\d{4}$/, "password must be exactly 4 digits");

export const RegisterRequestSchema = registry.register(
  "RegisterRequest",
  z
    .object({
      phone: z
        .string({ required_error: "phone is required" })
        .min(1, "phone is required")
        .openapi({ example: "+254712000001" }),
      role: roleSchema,
      password: passwordSchema.openapi({ example: "1234" }),
      name: z.string().trim().min(1).max(80).optional().openapi({ example: "John Doe" }),
      email: z.string().trim().email().max(254).optional().openapi({ example: "john@example.com" }),
    })
    .strict(),
);

export const ConfirmRegistrationRequestSchema = registry.register(
  "ConfirmRegistrationRequest",
  z
    .object({
      phone: z.string().min(1).openapi({ example: "+254712000001" }),
      role: roleSchema,
      code: z
        .string({ required_error: "code is required" })
        .regex(/^\d{4,6}$/, "code must be 4–6 digits")
        .openapi({ example: "123456" }),
    })
    .strict(),
);

export const LoginRequestSchema = registry.register(
  "LoginRequest",
  z
    .object({
      identifier: z
        .string({ required_error: "identifier is required" })
        .min(1, "identifier is required")
        .openapi({
          example: "+254712000001",
          description: "E.164 phone or email address.",
        }),
      password: z.string({ required_error: "password is required" }).min(1),
      role: roleSchema,
    })
    .strict(),
);

export const ForgotPasswordRequestSchema = registry.register(
  "ForgotPasswordRequest",
  z
    .object({
      phone: z
        .string({ required_error: "phone is required" })
        .min(1, "phone is required")
        .openapi({ example: "+254712000001" }),
      role: roleSchema,
    })
    .strict(),
);

export const ResetPasswordRequestSchema = registry.register(
  "ResetPasswordRequest",
  z
    .object({
      phone: z.string().min(1).openapi({ example: "+254712000001" }),
      role: roleSchema,
      code: z
        .string({ required_error: "code is required" })
        .regex(/^\d{4,6}$/, "code must be 4–6 digits")
        .openapi({ example: "123456" }),
      password: passwordSchema.openapi({ example: "5678" }),
    })
    .strict(),
);

export const RegisterResponseSchema = registry.register(
  "RegisterResponse",
  z.object({
    ok: z.literal(true),
    expiresInSeconds: z.number().int(),
    devCode: z.string().optional(),
  }),
);

export const ConfirmRegistrationResponseSchema = registry.register(
  "ConfirmRegistrationResponse",
  z.object({
    ok: z.literal(true),
    user: UserSchema,
    sessionToken: z.string(),
  }),
);

export const LoginResponseSchema = registry.register(
  "LoginResponse",
  z.object({
    sessionToken: z.string(),
    user: UserSchema,
  }),
);

export const ForgotPasswordResponseSchema = registry.register(
  "ForgotPasswordResponse",
  z.object({
    ok: z.literal(true),
    expiresInSeconds: z.number().int(),
    devCode: z.string().optional(),
  }),
);

export const ResetPasswordResponseSchema = registry.register(
  "ResetPasswordResponse",
  z.object({
    ok: z.literal(true),
    sessionToken: z.string(),
    user: UserSchema,
  }),
);

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
      // Signup fields — only honoured when the user is being created on this call.
      // Ignored if the (phone, role) user already exists.
      name: z
        .string()
        .trim()
        .min(1, "name cannot be empty")
        .max(80, "name is too long")
        .optional()
        .openapi({
          example: "John Doe",
          description:
            "Optional. Applied only when this verify creates a new user. Ignored for returning users.",
        }),
      email: z
        .string()
        .trim()
        .email("email is not valid")
        .max(254)
        .optional()
        .openapi({
          example: "john@example.com",
          description:
            "Optional. Applied only when this verify creates a new user. Ignored for returning users.",
        }),
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
    isNewUser: z.boolean().openapi({
      example: true,
      description:
        "`true` if this verify created the user (passwordless signup), `false` if it logged in an existing user. Mobile can use this to route to onboarding vs home.",
    }),
  }),
);

export const MeResponseSchema = registry.register("MeResponse", z.object({ user: UserSchema }));

export const LogoutResponseSchema = registry.register("LogoutResponse", z.object({ ok: z.literal(true) }));

// ---------------- Path registrations ----------------

registry.registerPath({
  method: "post",
  path: "/api/auth/register",
  tags: ["Auth"],
  summary: "Start sign-up (sends OTP to phone)",
  request: {
    body: { required: true, content: { "application/json": { schema: RegisterRequestSchema } } },
  },
  responses: {
    200: { description: "OTP sent.", content: { "application/json": { schema: RegisterResponseSchema } } },
    409: { description: "User already exists.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/register/confirm",
  tags: ["Auth"],
  summary: "Confirm sign-up OTP and create account",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: ConfirmRegistrationRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Account created with a 30-day session (same as login).",
      content: { "application/json": { schema: ConfirmRegistrationResponseSchema } },
    },
    401: { description: "Invalid OTP.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/password/forgot",
  tags: ["Auth"],
  summary: "Request a password-reset OTP (SMS)",
  request: {
    body: { required: true, content: { "application/json": { schema: ForgotPasswordRequestSchema } } },
  },
  responses: {
    200: {
      description: "If the account exists, an OTP was sent.",
      content: { "application/json": { schema: ForgotPasswordResponseSchema } },
    },
    400: { description: "Invalid input.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/password/reset",
  tags: ["Auth"],
  summary: "Verify reset OTP and set a new password",
  request: {
    body: { required: true, content: { "application/json": { schema: ResetPasswordRequestSchema } } },
  },
  responses: {
    200: {
      description: "Password updated; new session issued.",
      content: { "application/json": { schema: ResetPasswordResponseSchema } },
    },
    401: { description: "Invalid OTP.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
    400: { description: "Weak password.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/login",
  tags: ["Auth"],
  summary: "Sign in with phone or email and password",
  request: {
    body: { required: true, content: { "application/json": { schema: LoginRequestSchema } } },
  },
  responses: {
    200: { description: "Session created.", content: { "application/json": { schema: LoginResponseSchema } } },
    401: { description: "Invalid credentials.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

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
