import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { MpesaService } from "./mpesa.service.js";
import { completeBookingPayment } from "./booking-payment.service.js";

const STK_FAILED_RESULT_CODES = new Set(["1032", "1037", "1", "2001"]);

function extractReceiptFromStkQuery(data: Record<string, unknown>): string | null {
  const callbackMetadata = data.CallbackMetadata as
    | { Item?: Array<{ Name?: string; Value?: unknown }> }
    | undefined;
  const items = callbackMetadata?.Item ?? [];
  const receipt = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value;
  return receipt != null ? String(receipt) : null;
}

/** Query Safaricom and complete or fail a pending STK payment if the callback was missed. */
export async function reconcilePendingStkPayment(
  paymentId: string,
): Promise<"completed" | "failed" | "pending" | "not_found"> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: true },
  });
  if (!payment?.mpesaCheckoutRequestId) return "not_found";
  if (payment.status === "succeeded") return "completed";
  if (payment.status !== "pending") return "failed";
  if (payment.booking.status !== "pending_payment") return "not_found";

  const mpesa = new MpesaService();
  const result = await mpesa.stkQuery(payment.mpesaCheckoutRequestId);
  if (result.status !== "success" || !result.data) return "pending";

  const data = result.data;
  const resultCode = String(data.ResultCode ?? "");

  if (resultCode === "0") {
    const receipt = extractReceiptFromStkQuery(data) ?? payment.mpesaCheckoutRequestId;
    await completeBookingPayment(payment.booking, payment, receipt, { stk_query: data });
    return "completed";
  }

  if (resultCode && STK_FAILED_RESULT_CODES.has(resultCode)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "failed",
        gatewayResponse: {
          ...(typeof payment.gatewayResponse === "object" && payment.gatewayResponse
            ? (payment.gatewayResponse as Record<string, unknown>)
            : {}),
          stk_query: data,
        } as Prisma.InputJsonValue,
      },
    });
    return "failed";
  }

  return "pending";
}
