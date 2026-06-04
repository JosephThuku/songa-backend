import { SavedPlaceKind, UserRole } from "@prisma/client";
import { decodeBase64Image, saveAvatarFile } from "../lib/avatar-upload.js";
import { AppError } from "../lib/errors.js";
import { normalizeEmail } from "../lib/identifier.js";
import { normalizePhone } from "../lib/phone.js";
import { getMpesaDisplayConfig } from "../config/mpesa-display.js";
import { prisma } from "../lib/prisma.js";
import { toUserDto } from "../lib/responses.js";

const PAYMENT_TYPES = ["cash", "mpesa", "card"] as const;
export type PaymentMethodType = (typeof PAYMENT_TYPES)[number];

export type SavedPlaceDto = {
  id: string;
  label: string;
  kind: "home" | "work" | "other";
  placeId: string | null;
  lat: number;
  lng: number;
  createdAt: string;
};

export type PaymentMethodDto = {
  id: string;
  type: PaymentMethodType;
  isDefault: boolean;
  mpesaPhone: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
};

export type PassengerProfileDto = {
  user: ReturnType<typeof toUserDto>;
  totalTrips: number;
  savedPlaces: SavedPlaceDto[];
  paymentMethods: PaymentMethodDto[];
};

function toSavedPlaceDto(place: {
  id: string;
  label: string;
  kind: SavedPlaceKind;
  placeId: string | null;
  lat: number;
  lng: number;
  createdAt: Date;
}): SavedPlaceDto {
  return {
    id: place.id,
    label: place.label,
    kind: place.kind,
    placeId: place.placeId,
    lat: place.lat,
    lng: place.lng,
    createdAt: place.createdAt.toISOString(),
  };
}

function toPaymentMethodDto(row: {
  id: string;
  type: string;
  isDefault: boolean;
  mpesaPhone: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
}): PaymentMethodDto {
  const type = row.type as PaymentMethodType;
  if (!PAYMENT_TYPES.includes(type)) {
    throw new AppError("INVALID_PAYMENT_TYPE", 500, "Stored payment type is invalid.");
  }
  return {
    id: row.id,
    type,
    isDefault: row.isDefault,
    mpesaPhone: row.mpesaPhone,
    cardLast4: row.cardLast4,
    cardBrand: row.cardBrand,
  };
}

async function ensurePassenger(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { driverProfile: true },
  });
  if (!user || user.role !== UserRole.passenger) {
    throw new AppError("FORBIDDEN", 403, "Passenger profile only.");
  }
  return user;
}

async function ensureDefaultPaymentMethods(userId: string, accountPhone: string) {
  const existing = await prisma.paymentMethodPreference.findMany({ where: { userId } });
  if (existing.length > 0) return;

  await prisma.paymentMethodPreference.createMany({
    data: [
      { userId, type: "cash", isDefault: true },
      { userId, type: "mpesa", isDefault: false, mpesaPhone: accountPhone },
      { userId, type: "card", isDefault: false },
    ],
  });
}

export async function getPassengerProfile(userId: string): Promise<PassengerProfileDto> {
  const user = await ensurePassenger(userId);
  await ensureDefaultPaymentMethods(userId, user.phone);

  const [totalTrips, savedPlaces, paymentMethods] = await Promise.all([
    prisma.ride.count({ where: { passengerId: userId } }),
    prisma.savedPlace.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.paymentMethodPreference.findMany({ where: { userId }, orderBy: { type: "asc" } }),
  ]);

  return {
    user: toUserDto(user, user.driverProfile),
    totalTrips,
    savedPlaces: savedPlaces.map(toSavedPlaceDto),
    paymentMethods: paymentMethods.map(toPaymentMethodDto),
  };
}

export async function updatePassengerProfile(
  userId: string,
  input: { name?: string; email?: string | null },
): Promise<PassengerProfileDto> {
  await ensurePassenger(userId);

  const data: { name?: string; email?: string | null } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new AppError("INVALID_INPUT", 400, "Name cannot be empty.");
    data.name = name;
  }
  if (input.email !== undefined) {
    if (input.email === null || input.email === "") {
      data.email = null;
    } else {
      data.email = normalizeEmail(input.email);
    }
  }

  if (Object.keys(data).length > 0) {
    await prisma.user.update({ where: { id: userId }, data });
  }

  return getPassengerProfile(userId);
}

export async function uploadPassengerAvatar(
  userId: string,
  input: { imageBase64: string; mimeType: string },
  publicBaseUrl: string,
): Promise<PassengerProfileDto> {
  await ensurePassenger(userId);
  const buffer = decodeBase64Image(input.imageBase64);
  const { relativePath } = await saveAvatarFile(userId, buffer, input.mimeType);
  const base = publicBaseUrl.replace(/\/$/, "");
  const avatarUrl = `${base}${relativePath}`;

  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
  });

  return getPassengerProfile(userId);
}

export async function clearPassengerAvatar(userId: string): Promise<PassengerProfileDto> {
  await ensurePassenger(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
  });
  return getPassengerProfile(userId);
}

export async function createSavedPlace(
  userId: string,
  input: {
    label: string;
    kind?: "home" | "work" | "other";
    placeId?: string;
    lat: number;
    lng: number;
  },
): Promise<SavedPlaceDto> {
  await ensurePassenger(userId);
  const label = input.label.trim();
  if (!label) throw new AppError("INVALID_INPUT", 400, "Place label is required.");

  const kind =
    input.kind === "home"
      ? SavedPlaceKind.home
      : input.kind === "work"
        ? SavedPlaceKind.work
        : SavedPlaceKind.other;

  const place = await prisma.savedPlace.create({
    data: {
      userId,
      label,
      kind,
      placeId: input.placeId ?? null,
      lat: input.lat,
      lng: input.lng,
    },
  });

  return toSavedPlaceDto(place);
}

export async function deleteSavedPlace(userId: string, placeId: string): Promise<void> {
  await ensurePassenger(userId);
  const deleted = await prisma.savedPlace.deleteMany({ where: { id: placeId, userId } });
  if (deleted.count === 0) {
    throw new AppError("NOT_FOUND", 404, "Saved place not found.");
  }
}

export async function updatePaymentMethods(
  userId: string,
  input: {
    defaultType: PaymentMethodType;
    mpesaPhone?: string;
    cardLast4?: string;
    cardBrand?: string;
  },
): Promise<PaymentMethodDto[]> {
  const user = await ensurePassenger(userId);
  await ensureDefaultPaymentMethods(userId, user.phone);

  if (!PAYMENT_TYPES.includes(input.defaultType)) {
    throw new AppError("INVALID_INPUT", 400, "Invalid payment method type.");
  }

  let mpesaPhone = user.phone;
  if (input.mpesaPhone !== undefined) {
    mpesaPhone = normalizePhone(input.mpesaPhone);
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethodPreference.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    for (const type of PAYMENT_TYPES) {
      await tx.paymentMethodPreference.upsert({
        where: { userId_type: { userId, type } },
        create: {
          userId,
          type,
          isDefault: type === input.defaultType,
          mpesaPhone: type === "mpesa" ? mpesaPhone : null,
          cardLast4: type === "card" ? input.cardLast4 ?? null : null,
          cardBrand: type === "card" ? input.cardBrand ?? null : null,
        },
        update: {
          isDefault: type === input.defaultType,
          ...(type === "mpesa" ? { mpesaPhone } : {}),
          ...(type === "card"
            ? {
                cardLast4: input.cardLast4 ?? null,
                cardBrand: input.cardBrand ?? null,
              }
            : {}),
        },
      });
    }
  });

  const rows = await prisma.paymentMethodPreference.findMany({
    where: { userId },
    orderBy: { type: "asc" },
  });
  return rows.map(toPaymentMethodDto);
}

export function getSupportInfo() {
  return {
    title: "Help & Support",
    channels: [
      {
        id: "faq",
        label: "Help centre",
        subtitle: "Trips, payments, and safety",
        type: "in_app",
      },
      {
        id: "email",
        label: "Email us",
        subtitle: "support@songa.app",
        type: "email",
        value: "support@songa.app",
      },
      {
        id: "phone",
        label: "Call support",
        subtitle: "+254 700 000 000",
        type: "phone",
        value: "+254700000000",
      },
      {
        id: "whatsapp",
        label: "WhatsApp",
        subtitle: "Chat with Songa support",
        type: "whatsapp",
        value: "254700000000",
      },
    ],
    paymentHints: [
      "M-Pesa is the most common way to pay for rides in Kenya.",
      "You can pay with cash to the driver when your trip ends.",
      "Cards are charged after the trip, similar to Bolt.",
      "Set your default payment method so checkout is faster.",
    ],
    mpesa: getMpesaDisplayConfig(),
  };
}
