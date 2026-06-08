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

export interface SmsEnvConfig {
  apiKey?: string;
  senderId?: string;
  baseUrl?: string;
}

function resolveSmsConfig(env?: SmsEnvConfig): {
  apiKey: string | undefined;
  senderId: string;
  baseUrl: string;
} {
  const apiKey = (env?.apiKey ?? process.env.WASILIANA_API_KEY)?.trim() || undefined;
  const senderId = (env?.senderId ?? process.env.WASILIANA_SENDER_ID)?.trim() || "SONGA";
  const baseUrl =
    (env?.baseUrl ?? process.env.WASILIANA_BASE_URL)?.trim() || "https://api.wasiliana.com";
  return { apiKey, senderId, baseUrl };
}

/** True when Wasiliana credentials are configured (real SMS, not console fallback). */
export function isSmsConfigured(env?: SmsEnvConfig): boolean {
  return Boolean(resolveSmsConfig(env).apiKey);
}

export function getSmsProvider(env?: SmsEnvConfig): SmsProvider {
  if (cached && !env) return cached;

  const { apiKey, senderId, baseUrl } = resolveSmsConfig(env);

  if (apiKey) {
    const provider = new WasilianaProvider({ apiKey, senderId, baseUrl });
    if (!env) {
      cached = provider;
      logger.info({ senderId }, "SMS provider: Wasiliana");
    }
    return provider;
  }

  const consoleProvider = new ConsoleSmsProvider();
  if (!env) {
    cached = consoleProvider;
    logger.info("WASILIANA_API_KEY not set — using console SMS fallback (dev only)");
  }
  return consoleProvider;
}

/** Boot-time diagnostic — call after loadEnv(). */
export function logSmsProviderStatus(env?: SmsEnvConfig): void {
  const { apiKey, senderId } = resolveSmsConfig(env);
  if (apiKey) {
    logger.info({ senderId }, "OTP SMS: Wasiliana configured");
    return;
  }
  const senderConfigured = Boolean((env?.senderId ?? process.env.WASILIANA_SENDER_ID)?.trim());
  if (senderConfigured) {
    logger.warn(
      { senderId },
      "WASILIANA_SENDER_ID is set but WASILIANA_API_KEY is empty — OTP SMS will NOT be sent (console fallback only)",
    );
    return;
  }
  logger.info("OTP SMS: console fallback (set WASILIANA_API_KEY for real SMS)");
}

/** Test-only — override the resolved provider. Pass `null` to reset. */
export function _setSmsProvider(provider: SmsProvider | null): void {
  cached = provider;
}
