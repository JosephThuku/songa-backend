import { Prisma } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { completeBookingPayment } from "../services/booking-payment.service.js";
import {
  handleC2bConfirmation,
  handleC2bValidation,
  type C2bPayload,
} from "../services/mpesa-c2b.service.js";
import {
  refundFailedCashout,
  completeCashout,
  findPendingCashoutByOriginator,
} from "../services/wallet.service.js";

const router: Router = Router();

/** Safaricom STK callback — public, no auth. */
router.post(
  "/stk-callback",
  asyncHandler(async (req, res) => {
    logger.info({ payload: req.body }, "M-Pesa STK callback");

    const body = req.body as {
      Body?: {
        stkCallback?: {
          CheckoutRequestID?: string;
          ResultCode?: number;
          ResultDesc?: string;
          CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: unknown }> };
        };
      };
    };

    const callback = body.Body?.stkCallback;
    const checkoutRequestId = callback?.CheckoutRequestID;
    if (!checkoutRequestId) {
      res.json({ ResultCode: 0, ResultDesc: "Success" });
      return;
    }

    const payment = await prisma.payment.findFirst({
      where: { mpesaCheckoutRequestId: checkoutRequestId, status: "pending" },
      include: { booking: true },
    });

    if (!payment || payment.booking.status !== "pending_payment") {
      logger.warn({ checkoutRequestId }, "STK callback: no pending payment");
      res.json({ ResultCode: 0, ResultDesc: "Success" });
      return;
    }

    const resultCode = callback?.ResultCode ?? -1;
    if (resultCode === 0) {
      const items = callback?.CallbackMetadata?.Item ?? [];
      const receipt = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value;
      const mpesaReceipt = receipt != null ? String(receipt) : null;

      await completeBookingPayment(payment.booking, payment, mpesaReceipt, {
        stk_callback: req.body,
      });
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "failed",
          gatewayResponse: {
            ...(typeof payment.gatewayResponse === "object" && payment.gatewayResponse
              ? (payment.gatewayResponse as Record<string, unknown>)
              : {}),
            stk_callback: req.body,
            result_desc: callback?.ResultDesc,
          } as Prisma.InputJsonValue,
        },
      });
    }

    res.json({ ResultCode: 0, ResultDesc: "Success" });
  }),
);

/** Safaricom C2B validation — public, no auth. */
router.post(
  "/c2b-validation",
  asyncHandler(async (req, res) => {
    logger.info({ payload: req.body }, "M-Pesa C2B validation");
    const result = await handleC2bValidation(req.body as C2bPayload);
    res.json(result);
  }),
);

/** Safaricom C2B confirmation — public, no auth. */
router.post(
  "/c2b-confirmation",
  asyncHandler(async (req, res) => {
    logger.info({ payload: req.body }, "M-Pesa C2B confirmation");
    await handleC2bConfirmation(req.body as C2bPayload);
    res.json({ ResultCode: 0, ResultDesc: "Success" });
  }),
);

/** Safaricom B2C result callback. */
router.post(
  "/b2c-callback",
  asyncHandler(async (req, res) => {
    logger.info({ payload: req.body }, "M-Pesa B2C callback");

    const result = (req.body as { Result?: Record<string, unknown> }).Result;
    const originatorId = result?.OriginatorConversationID;
    if (!originatorId || typeof originatorId !== "string") {
      res.json({ ResultCode: 0, ResultDesc: "Success" });
      return;
    }

    const tx = await findPendingCashoutByOriginator(originatorId);

    if (!tx) {
      logger.warn({ originatorId }, "B2C callback: withdrawal not found");
      res.json({ ResultCode: 0, ResultDesc: "Success" });
      return;
    }

    const resultCode = Number(result.ResultCode ?? -1);
    if (resultCode === 0) {
      await completeCashout(tx.id, { b2c_callback: req.body });
    } else {
      await refundFailedCashout(tx.id, String(result.ResultDesc ?? "B2C failed"), {
        b2c_callback: req.body,
      });
    }

    res.json({ ResultCode: 0, ResultDesc: "Success" });
  }),
);

router.post(
  "/b2c-timeout",
  asyncHandler(async (req, res) => {
    logger.warn({ payload: req.body }, "M-Pesa B2C timeout");

    const result = (req.body as { Result?: Record<string, unknown> }).Result;
    const originatorId = result?.OriginatorConversationID;
    if (originatorId && typeof originatorId === "string") {
      const tx = await findPendingCashoutByOriginator(originatorId);
      if (tx) {
        await refundFailedCashout(tx.id, "B2C timeout", { b2c_timeout: req.body });
      }
    }

    res.json({ ResultCode: 0, ResultDesc: "Success" });
  }),
);

export default router;
