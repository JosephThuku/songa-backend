// Shared schemas used across multiple endpoints: error envelope, user DTO,
// driver profile DTO. Registered with the central OpenAPI registry so every
// endpoint can reference them by $ref.

import { z } from "zod";
import { registry } from "./openapi-registry.js";

// ---------------- Error envelope (backend-requirements.md §10) ----------------

export const ErrorEnvelopeSchema = registry.register(
  "ErrorEnvelope",
  z
    .object({
      error: z.object({
        code: z.string().openapi({ example: "RIDE_NOT_CANCELLABLE" }),
        message: z.string().openapi({ example: "Cannot cancel after driver has arrived." }),
        details: z.record(z.unknown()).optional(),
      }),
    })
    .openapi({
      description:
        "Canonical error shape used by every endpoint. See backend-requirements.md §10 for the full code table.",
    }),
);

// ---------------- DriverProfile (§2.4 / §3.5) ----------------

export const DriverProfileSchema = registry.register(
  "DriverProfile",
  z
    .object({
      isOnline: z.boolean().openapi({ example: false }),
      acceptanceRate: z.number().int().min(0).max(100).openapi({ example: 94 }),
      vehicleId: z.string().nullable().openapi({ example: "veh-1" }),
      onboardingStatus: z.enum(["pending", "approved", "rejected"]).openapi({ example: "approved" }),
      lastLocation: z
        .object({
          lat: z.number().min(-90).max(90).openapi({ example: -1.2674 }),
          lng: z.number().min(-180).max(180).openapi({ example: 36.807 }),
          heading: z.number().min(0).max(360).optional().openapi({ example: 140 }),
          speedKmh: z.number().min(0).optional().openapi({ example: 32 }),
          updatedAt: z.string().datetime().openapi({ example: "2026-05-28T14:00:00.000Z" }),
        })
        .nullable()
        .optional(),
      vehicle: z
        .object({
          id: z.string(),
          type: z.string(),
          make: z.string(),
          model: z.string(),
          registration: z.string(),
          color: z.string(),
          year: z.string().nullable(),
          seats: z.number().int(),
          status: z.string(),
        })
        .nullable()
        .optional()
        .openapi({
          description:
            "Driver's currently registered vehicle, embedded so the mobile app can render the home card without an extra round-trip.",
        }),
    })
    .openapi({ description: "Driver-only profile fields, returned only when `user.role === 'driver'`." }),
);

// ---------------- User (§2.3 / §2.4) ----------------

export const UserSchema = registry.register(
  "User",
  z
    .object({
      id: z.string().openapi({ example: "usr_8f3a2b1c", description: "Always prefixed `usr_`." }),
      role: z.enum(["passenger", "driver", "admin"]),
      name: z.string().nullable().openapi({ example: "John Doe" }),
      phone: z.string().openapi({ example: "+254712000001", description: "E.164" }),
      email: z.string().email().nullable().openapi({ example: "john@example.com" }),
      avatarUrl: z.string().max(2048).nullable().openapi({ example: null }),
      rating: z.number().min(0).max(5).openapi({ example: 4.9 }),
      createdAt: z.string().datetime().openapi({ example: "2025-01-15T10:00:00.000Z" }),
      driverProfile: DriverProfileSchema.optional(),
    })
    .openapi({
      description:
        "User DTO returned by `/login`, `/me`, and embedded in ride payloads. Matches backend-requirements.md §2.3 / §2.4.",
    }),
);

// ---------------- Health ----------------

export const HealthResponseSchema = registry.register(
  "HealthResponse",
  z.object({
    ok: z.literal(true),
    service: z.literal("songa-backend"),
  }),
);
