// SMS dispatch abstraction. The auth service calls `getSmsProvider().send(...)`
// to deliver OTP codes; this module decides at boot which concrete provider
// to use:
//
//   - WasilianaProvider — when WASILIANA_API_KEY is set (production / staging)
//   - ConsoleSmsProvider — fallback for dev / tests; logs the message to stdout
//
// Tests can override the resolved provider via `_setSmsProvider(provider)`.

import { logger } from "./logger.js";

export interface SmsMessage {
  /** Recipient phone in E.164 (e.g. "+254712345678"). */
  to: string;
  /** Plain-text body. Keep under 160 chars to fit a single SMS segment. */
  body: string;
  /** Optional alphanumeric sender ID. If omitted, the provider's default is used. */
  senderId?: string;
  /** Wasiliana: set `is_otp` on the request body (https://docs.wasiliana.com/sender-id). */
  isOtp?: boolean;
}

export interface SmsSendResult {
  ok: boolean;
  /** Provider-assigned message id, if any. */
  id?: string;
  /** Provider that handled the send (for observability). */
  provider: "wasiliana" | "console";
  /** Raw provider response, redacted of any secrets, for debugging. */
  raw?: unknown;
  /** Set when ok=false. */
  error?: string;
}

export interface SmsProvider {
  readonly name: "wasiliana" | "console";
  send(msg: SmsMessage): Promise<SmsSendResult>;
}

// ---------- Console (dev / test fallback) ----------

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console" as const;

  async send(msg: SmsMessage): Promise<SmsSendResult> {
    logger.info({ to: msg.to, body: msg.body, senderId: msg.senderId }, "[ConsoleSMS] would send");
    return { ok: true, provider: "console", id: `console_${Date.now()}` };
  }
}

// ---------- Wasiliana ----------
//
// API documentation: https://docs.wasiliana.com/
//
// The HTTP shape is filled in via configuration in src/lib/sms.wasiliana.ts —
// the actual request body, header name, and response parsing live there so
// they're easy to tweak once we lock down the docs.

import { WasilianaConfig, sendViaWasiliana } from "./sms.wasiliana.js";

export class WasilianaProvider implements SmsProvider {
  readonly name = "wasiliana" as const;
  constructor(private readonly config: WasilianaConfig) {}

  async send(msg: SmsMessage): Promise<SmsSendResult> {
    try {
      const result = await sendViaWasiliana(this.config, msg);
      return { ok: true, provider: "wasiliana", id: result.id, raw: result.raw };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ err, to: msg.to, senderId: msg.senderId ?? this.config.senderId }, "Wasiliana SMS send failed");
      if (error.includes("App does not match your api key")) {
        logger.warn(
          "Wasiliana rejected the API key for this sender ID — use the key from the same app in the Wasiliana dashboard that owns this sender.",
        );
      }
      return { ok: false, provider: "wasiliana", error };
    }
  }
}

// ---------- Resolver ----------

let cached: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;

  const apiKey = process.env.WASILIANA_API_KEY?.trim();
  const senderId = process.env.WASILIANA_SENDER_ID?.trim();

  if (apiKey) {
    cached = new WasilianaProvider({
      apiKey,
      senderId: senderId || "SONGA",
      baseUrl: process.env.WASILIANA_BASE_URL?.trim() || "https://api.wasiliana.com",
    });
    logger.info({ senderId: senderId || "SONGA" }, "SMS provider: Wasiliana");
  } else {
    cached = new ConsoleSmsProvider();
    logger.info("WASILIANA_API_KEY not set — using console SMS fallback (dev only)");
  }
  return cached;
}

/** Test-only — override the resolved provider. Pass `null` to reset. */
export function _setSmsProvider(provider: SmsProvider | null): void {
  cached = provider;
}
