import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { completeBookingPayment } from "./booking-payment.service.js";

export type C2bPayload = {
  TransID?: string;
  TransAmount?: string | number;
  BillRefNumber?: string;
  BusinessShortCode?: string;
  MSISDN?: string;
  TransTime?: string;
  TransactionType?: string;
};

function parseAmount(value: string | number | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function findPendingPaymentByBillRef(billRef: string) {
  const ref = billRef.trim().toUpperCase();
  if (!ref) return null;

  const payment = await prisma.payment.findFirst({
    where: {
      status: "pending",
      reference: ref,
      booking: { status: "pending_payment" },
    },
    include: { booking: true },
  });
  if (payment) return payment;

  const pending = await prisma.payment.findMany({
    where: {
      status: "pending",
      provider: "mpesa",
      booking: { status: "pending_payment" },
    },
    include: { booking: true },
    take: 100,
    orderBy: { createdAt: "desc" },
  });

  return (
    pending.find((p) => {
      const gw = p.gatewayResponse as Record<string, unknown> | null;
      const accountRef = gw?.account_reference;
      return typeof accountRef === "string" && accountRef.toUpperCase() === ref;
    }) ?? null
  );
}

export function validateC2bPayment(
  payment: { booking: { total: number } },
  payload: C2bPayload,
): { accept: boolean; reason?: string } {
  const amount = parseAmount(payload.TransAmount);
  if (amount == null) return { accept: false, reason: "Invalid amount" };
  if (amount !== payment.booking.total) return { accept: false, reason: "Amount mismatch" };
  return { accept: true };
}

export async function handleC2bValidation(payload: C2bPayload) {
  const billRef = payload.BillRefNumber?.trim();
  if (!billRef) {
    return { ResultCode: "C2B00012", ResultDesc: "Invalid BillRefNumber" };
  }

  const payment = await findPendingPaymentByBillRef(billRef);
  if (!payment) {
    logger.warn({ billRef }, "C2B validation: no pending payment");
    return { ResultCode: "C2B00012", ResultDesc: "Unknown account reference" };
  }

  const validation = validateC2bPayment(payment, payload);
  if (!validation.accept) {
    return { ResultCode: "C2B00013", ResultDesc: validation.reason ?? "Rejected" };
  }

  return { ResultCode: "0", ResultDesc: "Accepted" };
}

export async function handleC2bConfirmation(payload: C2bPayload) {
  const billRef = payload.BillRefNumber?.trim();
  if (!billRef) {
    logger.warn({ payload }, "C2B confirmation: missing BillRefNumber");
    return;
  }

  const payment = await findPendingPaymentByBillRef(billRef);
  if (!payment || payment.booking.status !== "pending_payment") {
    logger.warn({ billRef }, "C2B confirmation: no pending payment");
    return;
  }

  if (payment.status !== "pending") return;

  const validation = validateC2bPayment(payment, payload);
  if (!validation.accept) {
    logger.warn({ billRef, reason: validation.reason }, "C2B confirmation: validation failed");
    return;
  }

  const receipt = payload.TransID != null ? String(payload.TransID) : null;
  await completeBookingPayment(payment.booking, payment, receipt, {
    c2b_confirmation: payload,
  });
}
