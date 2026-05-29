import { z } from "zod";
import { registry } from "./openapi-registry.js";
import { UserSchema } from "./common.schema.js";

export const UploadPassengerAvatarSchema = registry.register(
  "UploadPassengerAvatarRequest",
  z
    .object({
      imageBase64: z.string().min(64),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    })
    .strict(),
);

export const UpdatePassengerProfileSchema = registry.register(
  "UpdatePassengerProfileRequest",
  z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      email: z.string().trim().email().max(254).nullable().optional(),
    })
    .strict(),
);

export const CreateSavedPlaceSchema = registry.register(
  "CreateSavedPlaceRequest",
  z
    .object({
      label: z.string().trim().min(1).max(120),
      kind: z.enum(["home", "work", "other"]).optional(),
      placeId: z.string().optional(),
      lat: z.number().finite(),
      lng: z.number().finite(),
    })
    .strict(),
);

export const UpdatePaymentMethodsSchema = registry.register(
  "UpdatePaymentMethodsRequest",
  z
    .object({
      defaultType: z.enum(["cash", "mpesa", "card"]),
      mpesaPhone: z.string().min(10).max(20).optional(),
      cardLast4: z.string().regex(/^\d{4}$/).optional(),
      cardBrand: z.string().max(32).optional(),
    })
    .strict(),
);

const SavedPlaceSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["home", "work", "other"]),
  placeId: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  createdAt: z.string().datetime(),
});

const PaymentMethodSchema = z.object({
  id: z.string(),
  type: z.enum(["cash", "mpesa", "card"]),
  isDefault: z.boolean(),
  mpesaPhone: z.string().nullable(),
  cardLast4: z.string().nullable(),
  cardBrand: z.string().nullable(),
});

export const PassengerProfileResponseSchema = registry.register(
  "PassengerProfileResponse",
  z.object({
    user: UserSchema,
    totalTrips: z.number().int(),
    savedPlaces: z.array(SavedPlaceSchema),
    paymentMethods: z.array(PaymentMethodSchema),
  }),
);
