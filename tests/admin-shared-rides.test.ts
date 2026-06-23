import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { seedSharedRidesCoast } from "../prisma/seeds/shared-rides-coast.js";
import { buildTestApp, createAuthSession, loginAsAdmin } from "./helpers.js";

function adminRequest(app: Express, sessionToken: string) {
  const auth = { Authorization: `Bearer ${sessionToken}` };
  return {
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string) => request(app).post(url).set(auth),
    patch: (url: string) => request(app).patch(url).set(auth),
    delete: (url: string) => request(app).delete(url).set(auth),
  };
}

describe("Admin shared rides API", () => {
  it("returns 401 without session and 403 for non-admin", async () => {
    const app = buildTestApp();
    const unauth = await request(app).post("/api/admin/shared-rides/corridor-locations").send({
      slug: "test-zone",
      name: "Test",
    });
    expect(unauth.status).toBe(401);

    const passenger = await createAuthSession(app, "+254799000099", "passenger");
    const forbidden = await request(app)
      .post("/api/admin/shared-rides/corridor-locations")
      .set("Authorization", `Bearer ${passenger.sessionToken}`)
      .send({ slug: "test-zone", name: "Test" });
    expect(forbidden.status).toBe(403);
  });

  it("creates, updates, and deactivates a corridor location", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const { sessionToken } = await loginAsAdmin(app);
    const admin = adminRequest(app, sessionToken);

    const created = await admin.post("/api/admin/shared-rides/corridor-locations").send({
      slug: "test-beach",
      name: "Test Beach",
      lat: -4.1,
      lng: 39.7,
      radiusM: 3000,
      sortOrder: 99,
    });
    expect(created.status).toBe(201);
    expect(created.body.location.slug).toBe("test-beach");

    const updated = await admin
      .patch(`/api/admin/shared-rides/corridor-locations/${created.body.location.id}`)
      .send({ name: "Test Beach Updated" });
    expect(updated.status).toBe(200);
    expect(updated.body.location.name).toBe("Test Beach Updated");

    const deactivated = await admin.delete(
      `/api/admin/shared-rides/corridor-locations/${created.body.location.id}`,
    );
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.location.isActive).toBe(false);
  });

  it("creates and patches an SGR schedule slot", async () => {
    const app = buildTestApp();
    const seed = await seedSharedRidesCoast(prisma);
    const { sessionToken } = await loginAsAdmin(app);
    const admin = adminRequest(app, sessionToken);

    const nyali = await prisma.corridorLocation.findUnique({ where: { slug: "nyali" } });
    expect(nyali).not.toBeNull();

    const created = await admin.post("/api/admin/shared-rides/sgr-schedule-slots").send({
      pickupLocationId: nyali!.id,
      dropoffLocationId: seed.sgrLocationId,
      direction: "to_sgr",
      trainService: "express",
      sgrEventTime: "16:00",
      vanDepartureTime: "13:30",
      suggestedPricePerSeat: 400,
      sortOrder: 5,
    });
    expect(created.status).toBe(201);
    expect(created.body.slot.suggestedPricePerSeat).toBe(400);

    const patched = await admin
      .patch(`/api/admin/shared-rides/sgr-schedule-slots/${created.body.slot.id}`)
      .send({ suggestedPricePerSeat: 425 });
    expect(patched.status).toBe(200);
    expect(patched.body.slot.suggestedPricePerSeat).toBe(425);

    const deactivated = await admin.delete(
      `/api/admin/shared-rides/sgr-schedule-slots/${created.body.slot.id}`,
    );
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.slot.isActive).toBe(false);
  });

  it("lists corridor locations and schedule slots with detail", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const { sessionToken } = await loginAsAdmin(app);
    const admin = adminRequest(app, sessionToken);

    const locations = await admin.get("/api/admin/shared-rides/corridor-locations?isActive=true");
    expect(locations.status).toBe(200);
    expect(locations.body.locations.length).toBeGreaterThan(0);
    expect(locations.body.locations[0]._count).toBeDefined();

    const nyali = locations.body.locations.find((l: { slug: string }) => l.slug === "nyali");
    expect(nyali).toBeDefined();

    const locationDetail = await admin.get(
      `/api/admin/shared-rides/corridor-locations/${nyali.id}`,
    );
    expect(locationDetail.status).toBe(200);
    expect(locationDetail.body.location.pickupSlots).toBeDefined();
    expect(locationDetail.body.location.dropoffSlots).toBeDefined();

    const slots = await admin.get(
      `/api/admin/shared-rides/sgr-schedule-slots?pickupLocationId=${nyali.id}`,
    );
    expect(slots.status).toBe(200);
    expect(slots.body.slots.length).toBeGreaterThan(0);

    const slotDetail = await admin.get(
      `/api/admin/shared-rides/sgr-schedule-slots/${slots.body.slots[0].id}`,
    );
    expect(slotDetail.status).toBe(200);
    expect(slotDetail.body.slot.pickupLocation).toBeDefined();
  });

  it("returns 409 when creating duplicate schedule slot", async () => {
    const app = buildTestApp();
    await seedSharedRidesCoast(prisma);
    const { sessionToken } = await loginAsAdmin(app);
    const admin = adminRequest(app, sessionToken);

    const existing = await prisma.sgrScheduleSlot.findFirst({
      where: { direction: "to_sgr", trainService: "inter_county", sgrEventTime: "08:00" },
    });
    expect(existing).not.toBeNull();

    const dup = await admin.post("/api/admin/shared-rides/sgr-schedule-slots").send({
      pickupLocationId: existing!.pickupLocationId,
      dropoffLocationId: existing!.dropoffLocationId,
      direction: existing!.direction,
      trainService: existing!.trainService,
      sgrEventTime: existing!.sgrEventTime,
      vanDepartureTime: existing!.vanDepartureTime,
      suggestedPricePerSeat: 999,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("SGR_SLOT_CONFLICT");
  });
});
