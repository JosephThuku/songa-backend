// OS-level push notification delivery via Expo's push API.
//
// Bug 6.1 — Notification rows already land in the DB; this module is the
// transport layer that wakes a device's OS push channel so the user sees the
// notification even when the app is backgrounded.
//
// Best-effort by design: any failure is logged but never thrown. Callers can
// fire-and-forget without worrying about breaking the underlying request.

import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Notification types that warrant an OS-level push (vs. in-app only). */
const PUSH_TYPES = new Set(["ride_offer", "ride_update"]);

export function shouldDeliverPush(type: string): boolean {
  if (PUSH_TYPES.has(type)) return true;
  return type.startsWith("payment_");
}

export interface ExpoPushInput {
  userId: string;
  title: string;
  body: string;
  type: string;
  deepLink?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  channelId: string;
  priority: "high";
  data: Record<string, unknown>;
}

function buildMessages(tokens: string[], input: ExpoPushInput): ExpoPushMessage[] {
  const channelId = input.type === "ride_offer" ? "ride-offers" : "default";
  const data: Record<string, unknown> = {
    type: input.type,
    deepLink: input.deepLink ?? null,
    ...(input.metadata ?? {}),
  };
  return tokens.map((to) => ({
    to,
    title: input.title,
    body: input.body,
    sound: "default",
    channelId,
    priority: "high",
    data,
  }));
}

/**
 * Dispatch an Expo push to every device registered for this user.
 * Skipped automatically in the test environment so unit/integration tests
 * never hit the real Expo endpoint.
 */
export async function sendExpoPushNotification(input: ExpoPushInput): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if (!shouldDeliverPush(input.type)) return;

  let devices: Array<{ pushToken: string }>;
  try {
    devices = await prisma.device.findMany({
      where: { userId: input.userId },
      select: { pushToken: true },
    });
  } catch (err) {
    logger.warn({ err, userId: input.userId }, "expo-push: failed to load devices");
    return;
  }

  const tokens = devices
    .map((d) => d.pushToken)
    .filter((t): t is string => typeof t === "string" && t.length > 0);
  if (tokens.length === 0) return;

  const messages = buildMessages(tokens, input);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
  };
  // Optional auth header — Expo push works anonymously, but enhanced security
  // mode requires this token. We read it lazily so tests can stub the env.
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: text.slice(0, 500), userId: input.userId },
        "expo-push: non-2xx response",
      );
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: Array<{ status?: string; message?: string; details?: unknown }> }
      | null;
    const tickets = json?.data ?? [];
    const errors = tickets.filter((t) => t.status === "error");
    if (errors.length > 0) {
      logger.warn({ errors, userId: input.userId }, "expo-push: ticket errors");
    }
  } catch (err) {
    logger.warn({ err, userId: input.userId }, "expo-push: dispatch error");
  }
}

/** Fire-and-forget wrapper for call sites that can't await. */
export function dispatchExpoPush(input: ExpoPushInput): void {
  void sendExpoPushNotification(input).catch((err) => {
    logger.warn({ err, userId: input.userId }, "expo-push: unhandled rejection");
  });
}
