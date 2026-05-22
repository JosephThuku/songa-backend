// Wasiliana HTTP adapter. The exact request shape (URL path, header name,
// JSON body keys) needs to be confirmed against the official docs at
// https://docs.wasiliana.com/. The values below are a best guess that matches
// common Kenyan SMS-provider patterns (apiKey header, JSON body with phone
// list + sender + message). To finalize, drop the relevant docs section into
// the codebase and adjust the three TODO markers below.

import type { SmsMessage } from "./sms.js";

export interface WasilianaConfig {
  apiKey: string;
  senderId: string;
  baseUrl: string;
}

export interface WasilianaSendResult {
  id: string;
  raw: unknown;
}

/**
 * Send a single SMS via Wasiliana.
 *
 * NOTE: filled in to the *likely* shape — confirm against the actual API docs
 * before production. The three points most likely to need tweaking are flagged
 * with `// TODO(wasiliana-docs)` comments.
 */
export async function sendViaWasiliana(
  config: WasilianaConfig,
  msg: SmsMessage,
): Promise<WasilianaSendResult> {
  // TODO(wasiliana-docs): confirm the exact endpoint path. Common candidates:
  //   POST /api/v1/sms/send-bulk
  //   POST /api/v1/sms/send
  //   POST /v1/messaging/send
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/v1/sms/send-bulk`;

  // TODO(wasiliana-docs): confirm the auth header name and value format.
  // Many Kenyan providers use one of:
  //   "apiKey: <key>"          (Africa's Talking-style)
  //   "Authorization: Bearer <key>"
  //   "X-API-KEY: <key>"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    apiKey: config.apiKey,
  };

  // TODO(wasiliana-docs): confirm the request body keys. Typical patterns:
  //   { "from": "SONGA", "to": ["+2547..."], "message": "..." }
  //   { "senderID": "SONGA", "recipients": [{ "phone": "..." }], "message": "..." }
  //   { "sender_id": "SONGA", "phones": "...", "message": "..." }
  //
  // The body below uses the "from / to-array / message" pattern. Adjust once
  // docs are confirmed.
  const body = {
    from: msg.senderId ?? config.senderId,
    to: [msg.to],
    message: msg.body,
  };

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
    // non-JSON response — keep the raw text in `raw`.
  }

  if (!response.ok) {
    throw new Error(
      `Wasiliana returned ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
    );
  }

  // TODO(wasiliana-docs): extract the real message id field name.
  const messageId =
    (parsed as { id?: string; messageId?: string; message_id?: string } | null)?.id ??
    (parsed as { messageId?: string } | null)?.messageId ??
    (parsed as { message_id?: string } | null)?.message_id ??
    `wasiliana_${Date.now()}`;

  return { id: messageId, raw: parsed };
}
