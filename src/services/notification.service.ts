import cuid from "cuid";
import { prisma } from "../lib/prisma.js";

export async function createNotification(input: {
  userId: string;
  title: string;
  body: string;
  type: string;
  deepLink?: string;
  metadata?: unknown;
}) {
  return prisma.notification.create({
    data: {
      id: `notif_${cuid()}`,
      userId: input.userId,
      title: input.title,
      body: input.body,
      type: input.type,
      deepLink: input.deepLink ?? null,
      metadata: input.metadata,
    },
  });
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

