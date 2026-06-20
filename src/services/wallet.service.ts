import cuid from "cuid";
import { Prisma } from "@prisma/client";
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
const DEFAULT_DAILY_SUBSCRIPTION_KES = 150;

type WalletDb = typeof prisma | Prisma.TransactionClient;

function dailySubscriptionAmountKes(): number {
  const raw = process.env.DRIVER_DAILY_SUBSCRIPTION_KES;
  if (!raw?.trim()) return DEFAULT_DAILY_SUBSCRIPTION_KES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nairobiServiceDate(at = new Date()): string {
  const p = getNairobiParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
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

export async function getDriverWallet(driverId: string) {
  const [transactions, balance, pendingPayout] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { driverId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    walletBalance(prisma, driverId),
    pendingPayoutAmount(prisma, driverId),
  ]);
  const subscriptionAmount = dailySubscriptionAmountKes();
  const subscriptionPaidToday = await subscriptionPaidForDate(
    prisma,
    driverId,
    nairobiServiceDate(),
  );
  const subscriptionDue = subscriptionPaidToday ? 0 : subscriptionAmount;
  const maxCashoutAmount = Math.max(0, balance - subscriptionDue);
  return {
    balance,
    availableBalance: balance,
    pendingPayout,
    subscriptionDue,
    maxCashoutAmount,
    currency: "KES",
    transactions: transactions.map(toWalletTransactionDto),
  };
}

export async function cashout(driverId: string, input: { amount: number; method: string; phone: string }) {
  const reserveResult = await withDriverWalletLock(driverId, async () =>
    prisma.$transaction(async (db) => {
      let balance = await walletBalance(db, driverId);
      const serviceDate = nairobiServiceDate();
      const subscriptionAmount = dailySubscriptionAmountKes();
      const subscriptionPaidToday =
        subscriptionAmount <= 0 || (await subscriptionPaidForDate(db, driverId, serviceDate));

      if (!subscriptionPaidToday) {
        if (balance < subscriptionAmount) {
          throw new AppError(
            "SUBSCRIPTION_DUE",
            409,
            "Daily driver subscription is due before cashout.",
            {
              subscriptionDue: subscriptionAmount,
              balance,
              maxCashoutAmount: 0,
            },
          );
        }

        await db.walletTransaction.create({
          data: {
            id: `tx_${cuid()}`,
            driverId,
            type: "subscription_fee",
            label: `Daily subscription · ${serviceDate}`,
            amount: -subscriptionAmount,
            status: "posted",
            metadata: { serviceDate, source: "cashout" } as Prisma.InputJsonValue,
          },
        });
        balance -= subscriptionAmount;
      }

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

  await tx.walletTransaction.create({
    data: {
      id: `tx_${cuid()}`,
      driverId: departure.driverId,
      type: "shared_booking_credit",
      label: sharedBookingCreditLabel(booking.pickup, booking.dropoff),
      amount: driverAmount,
      status: "posted",
      metadata: {
        bookingId: booking.id,
        sharedDepartureId: booking.sharedDepartureId,
        subtotal: gross,
        platformFee: booking.platformFee,
        holdbackPercent: holdPercent,
        holdbackAmount: holdAmount,
      } as Prisma.InputJsonValue,
    },
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
