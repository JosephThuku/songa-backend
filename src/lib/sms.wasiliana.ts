// Wasiliana SMS adapter — https://docs.wasiliana.com/sender-id
//
// POST https://api.wasiliana.com/api/v1/send/sms
// Headers: Content-Type: application/json, apiKey: <key>
// Body: { recipients: ["2547..."], from: "<sender>", message: "...", is_otp?: true }

import type { SmsMessage } from "./sms.js";

export interface WasilianaConfig {
  apiKey: string;
  senderId: string;
  /** Host only, e.g. https://api.wasiliana.com */
  baseUrl: string;
}

export interface WasilianaSendResult {
  id: string;
  raw: unknown;
}

/** Wasiliana expects national format without '+', e.g. 254712345678. */
export function toWasilianaRecipient(e164: string): string {
  return e164.replace(/^\+/, "").trim();
}

export async function sendViaWasiliana(
  config: WasilianaConfig,
  msg: SmsMessage,
): Promise<WasilianaSendResult> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/v1/send/sms`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    apiKey: config.apiKey,
  };

  const body: Record<string, unknown> = {
    recipients: [toWasilianaRecipient(msg.to)],
    from: msg.senderId ?? config.senderId,
    message: msg.body,
  };
  if (msg.isOtp) {
    body.is_otp = true;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }

  if (!response.ok) {
    let detail = text.slice(0, 300);
    if (parsed && typeof parsed === "object" && "message" in parsed) {
      const msg = (parsed as { message?: string; code?: number }).message;
      const code = (parsed as { code?: number }).code;
      detail = [msg, code !== undefined ? `code ${code}` : null].filter(Boolean).join(" — ");
    }
    throw new Error(`Wasiliana returned ${response.status}: ${detail}`);
  }

  if (parsed && typeof parsed === "object" && "status" in parsed) {
    const envelope = parsed as { status?: string; data?: string; message?: string };
    if (envelope.status === "failed") {
      const detail = envelope.data ?? envelope.message ?? text;
      throw new Error(`Wasiliana dispatch failed: ${detail}`);
    }
  }

  const messageId =
    (parsed as { id?: string; messageId?: string; message_uid?: string } | null)?.message_uid ??
    (parsed as { id?: string } | null)?.id ??
    `wasiliana_${Date.now()}`;

  return { id: messageId, raw: parsed };
}
