import cuid from "cuid";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { dispatchExpoPush, shouldDeliverPush } from "../lib/expo-push.js";

export async function createNotification(input: {
  userId: string;
  title: string;
  body: string;
  type: string;
  deepLink?: string;
  metadata?: unknown;
}) {
  const notification = await prisma.notification.create({
    data: {
      id: `notif_${cuid()}`,
      userId: input.userId,
      title: input.title,
      body: input.body,
      type: input.type,
      deepLink: input.deepLink ?? null,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  // Bug 6.1 — best-effort OS-level push for high-signal notification types.
  // Failures are swallowed inside the helper; callers never see them.
  if (shouldDeliverPush(input.type)) {
    dispatchExpoPush({
      userId: input.userId,
      title: input.title,
      body: input.body,
      type: input.type,
      deepLink: input.deepLink ?? null,
      metadata:
        input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
          ? (input.metadata as Record<string, unknown>)
          : null,
    });
  }

  return notification;
}

export async function getNotifications(userId: string, limit: number) {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return {
    notifications: notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      time: notification.createdAt.toISOString(),
      read: notification.read,
      type: notification.type,
      deepLink: notification.deepLink,
    })),
  };
}

export async function registerDevice(userId: string, input: { pushToken: string; platform: string }) {
  const device = await prisma.device.upsert({
    where: { pushToken: input.pushToken },
    update: { userId, platform: input.platform },
    create: { id: `dev_${cuid()}`, userId, pushToken: input.pushToken, platform: input.platform },
  });
  return {
    device: {
      id: device.id,
      pushToken: device.pushToken,
      platform: device.platform,
    },
  };
}

