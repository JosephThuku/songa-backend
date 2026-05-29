import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendExpoPushNotification, shouldDeliverPush } from "../src/lib/expo-push.js";
import { prisma } from "../src/lib/prisma.js";

describe("expo-push helper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = "test";
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env.NODE_ENV = "test";
    vi.restoreAllMocks();
  });

  it("flags only ride and payment notification types for OS-level delivery", () => {
    expect(shouldDeliverPush("ride_offer")).toBe(true);
    expect(shouldDeliverPush("ride_update")).toBe(true);
    expect(shouldDeliverPush("payment_succeeded")).toBe(true);
    expect(shouldDeliverPush("payment_failed")).toBe(true);
    expect(shouldDeliverPush("system")).toBe(false);
    expect(shouldDeliverPush("marketing")).toBe(false);
  });

  it("never calls fetch while NODE_ENV=test (safe-by-default in CI)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await sendExpoPushNotification({
      userId: "user_does_not_matter",
      title: "t",
      body: "b",
      type: "ride_offer",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the Expo endpoint when devices are registered (NODE_ENV!=test)", async () => {
    const user = await prisma.user.create({
      data: { id: `usr_${Date.now()}`, phone: "+254700000999", role: "passenger" },
    });
    await prisma.device.create({
      data: {
        id: `dev_${Date.now()}`,
        userId: user.id,
        pushToken: "ExponentPushToken[fake-token-abc]",
        platform: "ios",
      },
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 }));
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      await sendExpoPushNotification({
        userId: user.id,
        title: "New ride request",
        body: "Westlands → Kilimani",
        type: "ride_offer",
        deepLink: "songa://rides/r_1",
        metadata: { rideId: "r_1" },
      });
    } finally {
      process.env.NODE_ENV = prevEnv;
    }

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect((init as RequestInit).method).toBe("POST");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(Array.isArray(sent)).toBe(true);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[fake-token-abc]",
      title: "New ride request",
      body: "Westlands → Kilimani",
      data: { type: "ride_offer", deepLink: "songa://rides/r_1", rideId: "r_1" },
    });
  });

  it("does not throw when Expo returns a 5xx response", async () => {
    const user = await prisma.user.create({
      data: { id: `usr2_${Date.now()}`, phone: "+254700000888", role: "passenger" },
    });
    await prisma.device.create({
      data: {
        id: `dev2_${Date.now()}`,
        userId: user.id,
        pushToken: "ExponentPushToken[fake-token-xyz]",
        platform: "android",
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("upstream down", { status: 503 }));
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      await expect(
        sendExpoPushNotification({
          userId: user.id,
          title: "Driver accepted",
          body: "Your driver is on the way.",
          type: "ride_update",
        }),
      ).resolves.toBeUndefined();
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
