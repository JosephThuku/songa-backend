import cuid from "cuid";
import { Prisma } from "@prisma/client";
import { driverDailySubscriptionKes } from "../config/driver-subscription.js";
import { sharedRidesDriverHoldbackPercent } from "../config/shared-rides.js";
import { AppError } from "../lib/errors.js";
import { getNairobiParts } from "../lib/nairobi-time.js";
import { prisma } from "../lib/prisma.js";
import { getRedis } from "../lib/redis.js";
import { isMpesaB2cConfigured } from "../config/mpesa.js";
import { MpesaService } from "./mpesa.service.js";
import { logger } from "../lib/logger.js";

const WALLET_LOCK_MS = 10_000;
const WALLET_LOCK_RETRIES = 20;
const WALLET_LOCK_RETRY_MS = 50;

type WalletDb = typeof prisma | Prisma.TransactionClient;

function nairobiServiceDate(at = new Date()): string {
  const p = getNairobiParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function nairobiServiceDayBounds(serviceDate: string): { start: Date; end: Date } {
  const [year, month, day] = serviceDate.split("-").map((part) => Number.parseInt(part, 10));
  const start = new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, -3, 0, 0, 0));
  return { start, end };
}

async function getDriverVehicleType(db: WalletDb, driverId: string): Promise<string | null> {
  const profile = await db.driverProfile.findUnique({
    where: { userId: driverId },
    select: { vehicle: { select: { type: true } } },
  });
  return profile?.vehicle?.type ?? null;
}

function dailySubscriptionAmountKes(vehicleType?: string | null): number {
  return driverDailySubscriptionKes(vehicleType);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDriverWalletLock<T>(driverId: string, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  const key = `songa:wallet:lock:${driverId}`;
  for (let attempt = 0; attempt < WALLET_LOCK_RETRIES; attempt += 1) {
    const acquired = await redis.set(key, "1", { nx: true, pxMs: WALLET_LOCK_MS });
    if (acquired === "OK") {
      try {
        return await fn();
      } finally {
        await redis.del(key);
      }
    }
    await sleep(WALLET_LOCK_RETRY_MS);
  }
  throw new AppError("WALLET_BUSY", 409, "Wallet is processing another request. Try again.");
}

async function walletBalance(db: WalletDb, driverId: string): Promise<number> {
  const posted = await db.walletTransaction.aggregate({
    where: { driverId, status: "posted" },
    _sum: { amount: true },
  });
  const pendingDebits = await db.walletTransaction.aggregate({
    where: { driverId, type: "debit", status: "pending" },
    _sum: { amount: true },
  });
  return (posted._sum.amount ?? 0) + (pendingDebits._sum.amount ?? 0);
}

async function pendingPayoutAmount(db: WalletDb, driverId: string): Promise<number> {
  const pending = await db.walletTransaction.aggregate({
    where: { driverId, type: "debit", status: "pending" },
    _sum: { amount: true },
  });
  return Math.abs(pending._sum.amount ?? 0);
}

async function subscriptionPaidForDate(
  db: WalletDb,
  driverId: string,
  serviceDate: string,
): Promise<boolean> {
  const existing = await db.walletTransaction.findFirst({
    where: {
      driverId,
      type: "subscription_fee",
      status: "posted",
      metadata: { path: "$.serviceDate", equals: serviceDate },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function driverHasActivityToday(
  db: WalletDb,
  driverId: string,
  serviceDate: string,
): Promise<boolean> {
  const { start, end } = nairobiServiceDayBounds(serviceDate);
  const [ride, walletCredit] = await Promise.all([
    db.ride.findFirst({
      where: { driverId, phase: "trip_ended", updatedAt: { gte: start, lt: end } },
      select: { id: true },
    }),
    db.walletTransaction.findFirst({
      where: {
        driverId,
        createdAt: { gte: start, lt: end },
        amount: { gt: 0 },
        status: "posted",
      },
      select: { id: true },
    }),
  ]);
  return Boolean(ride || walletCredit);
}

async function computeEarningsBreakdown(driverId: string) {
  const [cashRides, mpesaCredits] = await Promise.all([
    prisma.ride.aggregate({
      where: { driverId, phase: "trip_ended", prepaid: false },
      _sum: { price: true },
    }),
    prisma.walletTransaction.aggregate({
      where: {
        driverId,
        status: "posted",
        type: { in: ["shared_booking_credit", "credit"] },
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
  ]);
  const totalCash = cashRides._sum.price ?? 0;
  const totalMpesa = mpesaCredits._sum.amount ?? 0;
  return {
    totalCash,
    totalMpesa,
    totalEarnings: totalCash + totalMpesa,
  };
}

/** Deduct today's subscription from wallet when balance allows (idempotent per service day). */
export async function maybeDeductDailySubscription(
  db: WalletDb,
  driverId: string,
  source: "cashout" | "wallet_credit",
): Promise<void> {
  const serviceDate = nairobiServiceDate();
  const vehicleType = await getDriverVehicleType(db, driverId);
  const subscriptionAmount = dailySubscriptionAmountKes(vehicleType);
  if (subscriptionAmount <= 0) return;
  if (await subscriptionPaidForDate(db, driverId, serviceDate)) return;

  const balance = await walletBalance(db, driverId);
  if (balance < subscriptionAmount) return;

  await db.walletTransaction.create({
    data: {
      id: `tx_${cuid()}`,
      driverId,
      type: "subscription_fee",
      label: `Daily subscription · ${serviceDate}`,
      amount: -subscriptionAmount,
      status: "posted",
      metadata: { serviceDate, source, vehicleType } as Prisma.InputJsonValue,
    },
  });
}

export async function postDriverWalletCredit(
  db: WalletDb,
  input: {
    driverId: string;
    type: string;
    label: string;
    amount: number;
    metadata?: Prisma.InputJsonValue;
    rideId?: string;
  },
) {
  const transaction = await db.walletTransaction.create({
    data: {
      id: `tx_${cuid()}`,
      driverId: input.driverId,
      type: input.type,
      label: input.label,
      amount: input.amount,
      status: "posted",
      rideId: input.rideId,
      metadata: input.metadata,
    },
  });
  await maybeDeductDailySubscription(db, input.driverId, "wallet_credit");
  return transaction;
}

export async function getDriverWallet(driverId: string) {
  const serviceDate = nairobiServiceDate();
  const vehicleType = await getDriverVehicleType(prisma, driverId);
  const subscriptionAmount = dailySubscriptionAmountKes(vehicleType);
  const [transactions, balance, pendingPayout, earnings, subscriptionPaidToday, hasActivityToday] =
    await Promise.all([
      prisma.walletTransaction.findMany({
        where: { driverId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      walletBalance(prisma, driverId),
      pendingPayoutAmount(prisma, driverId),
      computeEarningsBreakdown(driverId),
      subscriptionPaidForDate(prisma, driverId, serviceDate),
      driverHasActivityToday(prisma, driverId, serviceDate),
    ]);
  const subscriptionDue = subscriptionPaidToday ? 0 : subscriptionAmount;
  const maxCashoutAmount = Math.max(0, balance - subscriptionDue);
  const subscriptionOwed =
    !subscriptionPaidToday && hasActivityToday && balance < subscriptionAmount ? subscriptionAmount : 0;
  return {
    balance,
    availableBalance: balance,
    pendingPayout,
    subscriptionDue,
    maxCashoutAmount,
    withdrawable: maxCashoutAmount,
    currency: "KES",
    ...earnings,
    subscriptionOwed,
    transactions: transactions.map(toWalletTransactionDto),
  };
}

export async function cashout(driverId: string, input: { amount: number; method: string; phone: string }) {
  const reserveResult = await withDriverWalletLock(driverId, async () =>
    prisma.$transaction(async (db) => {
      const vehicleType = await getDriverVehicleType(db, driverId);
      const subscriptionAmount = dailySubscriptionAmountKes(vehicleType);
      const serviceDate = nairobiServiceDate();
      const subscriptionPaidToday =
        subscriptionAmount <= 0 || (await subscriptionPaidForDate(db, driverId, serviceDate));

      if (!subscriptionPaidToday) {
        const balanceBeforeFee = await walletBalance(db, driverId);
        if (balanceBeforeFee < subscriptionAmount) {
          throw new AppError(
            "SUBSCRIPTION_DUE",
            409,
            "Daily driver subscription is due before cashout.",
            {
              subscriptionDue: subscriptionAmount,
              balance: balanceBeforeFee,
              maxCashoutAmount: 0,
            },
          );
        }
        await maybeDeductDailySubscription(db, driverId, "cashout");
      }

      const balance = await walletBalance(db, driverId);

      if (input.amount > balance) {
        return {
          ok: false,
          error: {
            code: "INSUFFICIENT_FUNDS",
            message: "Insufficient wallet balance.",
            details: {
              balance,
              maxCashoutAmount: Math.max(0, balance),
            },
          },
        } as const;
      }

      const transaction = await db.walletTransaction.create({
        data: {
          id: `tx_${cuid()}`,
          driverId,
          type: "debit",
          label: `Cashout · ${input.method}`,
          amount: -input.amount,
          status: "pending",
          metadata: { method: input.method, phone: input.phone },
        },
      });
      return { ok: true, transaction } as const;
    }),
  );

  if (!reserveResult.ok) {
    throw new AppError(
      reserveResult.error.code,
      409,
      reserveResult.error.message,
      reserveResult.error.details,
    );
  }

  const transaction = reserveResult.transaction;

  if (input.method === "mpesa" && isMpesaB2cConfigured()) {
    const mpesa = new MpesaService();
    const result = await mpesa.initiateB2c({
      amount: input.amount,
      phone: input.phone,
      remarks: "Songa driver withdrawal",
      occasion: transaction.id,
    });

    if (result.status !== "success") {
      await refundFailedCashout(transaction.id, result.message ?? "B2C initiation failed", {
        b2c_init_error: result,
      });
      throw new AppError("CASHOUT_FAILED", 502, result.message ?? "Could not start M-Pesa payout.");
    }

    const data = result.data ?? {};
    const responseCode = String(data.ResponseCode ?? "");
    if (responseCode && responseCode !== "0") {
      await refundFailedCashout(
        transaction.id,
        String(data.ResponseDescription ?? "M-Pesa rejected payout"),
        { b2c_response: data },
      );
      throw new AppError(
        "CASHOUT_FAILED",
        502,
        String(data.ResponseDescription ?? "M-Pesa did not accept the payout request."),
      );
    }

    const originatorConversationId =
      typeof data.OriginatorConversationID === "string" ? data.OriginatorConversationID : null;
    await prisma.walletTransaction.update({
      where: { id: transaction.id },
      data: {
        metadata: {
          method: input.method,
          phone: input.phone,
          originatorConversationId,
          b2c_init: data,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      transaction: toWalletTransactionDto(
        await prisma.walletTransaction.findUniqueOrThrow({ where: { id: transaction.id } }),
      ),
      message: "Check your phone for the M-Pesa payout.",
    };
  }

  return {
    transaction: toWalletTransactionDto(transaction),
    message: isMpesaB2cConfigured()
      ? "Check your phone for the M-Pesa payout."
      : "Cashout recorded; configure M-Pesa B2C to send payouts automatically.",
  };
}

export async function completeCashout(transactionId: string, metadataMerge: Record<string, unknown> = {}) {
  const tx = await prisma.walletTransaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.status !== "pending") return;

  const existing =
    tx.metadata && typeof tx.metadata === "object" ? (tx.metadata as Record<string, unknown>) : {};

  await prisma.walletTransaction.update({
    where: { id: transactionId },
    data: {
      status: "posted",
      metadata: { ...existing, ...metadataMerge } as Prisma.InputJsonValue,
    },
  });
}

export async function refundFailedCashout(
  transactionId: string,
  reason: string,
  metadataMerge: Record<string, unknown> = {},
) {
  const tx = await prisma.walletTransaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.status !== "pending") return;

  const existing =
    tx.metadata && typeof tx.metadata === "object" ? (tx.metadata as Record<string, unknown>) : {};

  await prisma.$transaction(async (db) => {
    await db.walletTransaction.update({
      where: { id: transactionId },
      data: {
        status: "failed",
        metadata: { ...existing, ...metadataMerge, failureReason: reason } as Prisma.InputJsonValue,
      },
    });
  });

  logger.warn({ transactionId, reason }, "Cashout failed — pending debit released");
}

export async function findPendingCashoutByOriginator(originatorConversationId: string) {
  const pending = await prisma.walletTransaction.findMany({
    where: { type: "debit", status: "pending" },
    take: 50,
  });
  return (
    pending.find((tx) => {
      const meta = tx.metadata as Record<string, unknown> | null;
      return meta?.originatorConversationId === originatorConversationId;
    }) ?? null
  );
}

/** Credit departure driver when a shared SGR booking is paid — idempotent per bookingId. */
export async function creditDriverForSharedBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  const existing = await tx.walletTransaction.findFirst({
    where: {
      type: "shared_booking_credit",
      metadata: { path: "$.bookingId", equals: bookingId },
    },
  });
  if (existing) return;

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      subtotal: true,
      platformFee: true,
      pickup: true,
      dropoff: true,
      sharedDepartureId: true,
    },
  });
  if (!booking?.sharedDepartureId) return;

  const departure = await tx.sharedDeparture.findUnique({
    where: { id: booking.sharedDepartureId },
    select: { driverId: true },
  });
  if (!departure?.driverId) return;

  const holdPercent = sharedRidesDriverHoldbackPercent();
  const gross = booking.subtotal;
  const holdAmount = Math.round((gross * holdPercent) / 100);
  const driverAmount = gross - holdAmount;

  await postDriverWalletCredit(tx, {
    driverId: departure.driverId,
    type: "shared_booking_credit",
    label: sharedBookingCreditLabel(booking.pickup, booking.dropoff),
    amount: driverAmount,
    metadata: {
      bookingId: booking.id,
      sharedDepartureId: booking.sharedDepartureId,
      subtotal: gross,
      platformFee: booking.platformFee,
      holdbackPercent: holdPercent,
      holdbackAmount: holdAmount,
      paymentChannel: "mpesa",
    } as Prisma.InputJsonValue,
  });
}

function sharedBookingCreditLabel(pickup: unknown, dropoff: unknown): string {
  const from = placeLabel(pickup);
  const to = placeLabel(dropoff);
  return `Shared van · ${from} → ${to}`;
}

function placeLabel(value: unknown): string {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const label = typeof object.label === "string" ? object.label : "Trip";
  return label.split(",")[0] ?? label;
}

export function toWalletTransactionDto(tx: {
  id: string;
  label: string;
  amount: number;
  createdAt: Date;
  type: string;
  status: string;
  currency: string;
}) {
  return {
    id: tx.id,
    label: tx.label,
    amount: tx.amount,
    time: tx.createdAt.toISOString(),
    type: tx.type,
    status: tx.status,
    currency: tx.currency,
  };
}
