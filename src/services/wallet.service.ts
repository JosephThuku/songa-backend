import cuid from "cuid";
import { Prisma } from "@prisma/client";
import { sharedRidesDriverHoldbackPercent } from "../config/shared-rides.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { isMpesaB2cConfigured } from "../config/mpesa.js";
import { MpesaService } from "./mpesa.service.js";
import { logger } from "../lib/logger.js";

function walletBalanceFromTransactions(
  transactions: Array<{ amount: number; status: string; type: string }>,
): number {
  return transactions
    .filter((tx) => tx.status === "posted" || (tx.type === "debit" && tx.status === "pending"))
    .reduce((sum, tx) => sum + tx.amount, 0);
}

export async function getDriverWallet(driverId: string) {
  const transactions = await prisma.walletTransaction.findMany({
    where: { driverId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const balance = walletBalanceFromTransactions(transactions);
  const pendingPayout = Math.abs(
    transactions
      .filter((tx) => tx.type === "debit" && tx.status === "pending")
      .reduce((sum, tx) => sum + tx.amount, 0),
  );
  return {
    balance,
    pendingPayout,
    currency: "KES",
    transactions: transactions.map(toWalletTransactionDto),
  };
}

export async function cashout(driverId: string, input: { amount: number; method: string; phone: string }) {
  const wallet = await getDriverWallet(driverId);
  if (input.amount > wallet.balance) {
    throw new AppError("INSUFFICIENT_FUNDS", 409, "Insufficient wallet balance.");
  }

  const transaction = await prisma.walletTransaction.create({
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
    await db.walletTransaction.create({
      data: {
        id: `tx_${cuid()}`,
        driverId: tx.driverId,
        type: "credit",
        label: "Cashout refund",
        amount: Math.abs(tx.amount),
        status: "posted",
        metadata: { refundFor: transactionId, reason } as Prisma.InputJsonValue,
      },
    });
  });

  logger.warn({ transactionId, reason }, "Cashout failed — wallet refunded");
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
