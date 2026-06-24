import { logger } from "./logger.js";

/** Grep Render logs for `M-Pesa payment trace`. Set MPESA_PAYMENT_DEBUG=0 to silence. */
export function mpesaPaymentTrace(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  if (process.env.MPESA_PAYMENT_DEBUG === "0") return;
  logger.info({ ...fields, event }, "M-Pesa payment trace");
}
