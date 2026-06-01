import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/lib/openapi.js";
import { prisma } from "../src/lib/prisma.js";
import { seedSharedRidesCoast } from "../prisma/seeds/shared-rides-coast.js";
import { buildTestApp, createAuthSession } from "./helpers.js";

const PASSENGER_PHONE = "+254713100001";

async function login(app: Express): Promise<string> {
  const session = await createAuthSession(app, PASSENGER_PHONE, "passenger", {
    name: "Shared Rides Tester",
  });
  return session.sessionToken;
}

async function seedCoastCatalog() {
  return seedSharedRidesCoast(prisma);
}

describe("Shared rides API (Phase 1)", () => {
  it("registers OpenAPI paths under /api/shared-rides", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/api/shared-rides/corridor-locations"]).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/corridor-locations/resolve"]).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/suggestions"]).toBeDefined();
    expect(doc.paths?.["/api/shared-rides/departures/search"]).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/shared-rides/corridor-locations");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("lists corridor locations after coast seed", async () => {
    const app = buildTestApp();
    await seedCoastCatalog();
    const token = await login(app);

    const res = await request(app)
      .get("/api/shared-rides/corridor-locations")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const slugs = (res.body.locations as { slug: string }[]).map((l) => l.slug).sort();
    expect(slugs).toEqual([
      "bamburi",
      "diani",
      "mombasa-cbd",
      "mtwapa",
      "nyali",
      "sgr-miritini",
    ]);
    const sgr = res.body.locations.find((l: { slug: string }) => l.slug === "sgr-miritini");
    expect(sgr.lat).toBeCloseTo(-4.02178, 4);
    expect(sgr.lng).toBeCloseTo(39.57947, 4);
  });

  it("resolves GPS to Nyali corridor zone", async () => {
    const app = buildTestApp();
    await seedCoastCatalog();
    const token = await login(app);

    const res = await request(app)
      .post("/api/shared-rides/corridor-locations/resolve")
      .set("Authorization", `Bearer ${token}`)
      .send({ lat: -4.0207, lng: 39.7199 });

    expect(res.status).toBe(200);
    expect(res.body.location.slug).toBe("nyali");
    expect(res.body.insideRadius).toBe(true);
    expect(res.body.distanceM).toBeLessThan(100);
  });

  it("returns 404 for unknown corridor slug", async () => {
    const app = buildTestApp();
    await seedCoastCatalog();
    const token = await login(app);

    const res = await request(app)
      .get("/api/shared-rides/corridor-locations/unknown-zone")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CORRIDOR_LOCATION_NOT_FOUND");
  });

  it("returns 400 for invalid corridor slug format", async () => {
    const app = buildTestApp();
    await seedCoastCatalog();
    const token = await login(app);

    const res = await request(app)
      .get("/api/shared-rides/corridor-locations/Nyali%20Beach")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 when direction is missing on suggestions", async () => {
    const app = buildTestApp();
    await seedCoastCatalog();
    const token = await login(app);

    const res = await request(app)
      .get("/api/shared-rides/suggestions?corridorLocationSlug=nyali")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns schedule slots and suggestions for Nyali to_sgr", async () => {
    const app = buildTestApp();
    await seedCoastCatalog();
    const token = await login(app);

    const slotsRes = await request(app)
      .get("/api/shared-rides/sgr-schedule-slots?direction=to_sgr&corridorLocationSlug=nyali")
      .set("Authorization", `Bearer ${token}`);

    expect(slotsRes.status).toBe(200);
    expect(slotsRes.body.slots.length).toBeGreaterThanOrEqual(4);
    for (const row of slotsRes.body.slots) {
      expect(row.pickupLocation.slug).toBe("nyali");
      expect(row.dropoffLocation.slug).toBe("sgr-miritini");
      expect(row.direction).toBe("to_sgr");
    }

    const suggestRes = await request(app)
      .get("/api/shared-rides/suggestions?direction=to_sgr&corridorLocationSlug=nyali")
      .set("Authorization", `Bearer ${token}`);

    expect(suggestRes.status).toBe(200);
    expect(Array.isArray(suggestRes.body.suggestedTripRequests)).toBe(true);
    if (suggestRes.body.suggestedTripRequests.length > 0) {
      const first = suggestRes.body.suggestedTripRequests[0];
      expect(first).toMatchObject({
        direction: "to_sgr",
        corridorLocationSlug: "nyali",
        pricePerSeat: expect.any(Number),
        sgrScheduleSlotId: expect.any(String),
      });
      expect(first.vanDepartureAt).toMatch(/\+03:00$/);
    }
  });

  it("returns departures search with demo vans and Diani pricing", async () => {
    const app = buildTestApp();
    await seedCoastCatalog();
    const token = await login(app);

    const dianiSlots = await request(app)
      .get("/api/shared-rides/sgr-schedule-slots?direction=to_sgr&corridorLocationSlug=diani")
      .set("Authorization", `Bearer ${token}`);
    expect(dianiSlots.status).toBe(200);
    const expressSlot = dianiSlots.body.slots.find(
      (s: { trainService: string; vanDepartureTime: string }) =>
        s.trainService === "express" && s.vanDepartureTime === "12:00",
    );
    expect(expressSlot?.suggestedPricePerSeat).toBe(700);

    const searchRes = await request(app)
      .get("/api/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=nyali")
      .set("Authorization", `Bearer ${token}`);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.exactDepartures.length).toBeGreaterThanOrEqual(1);
    expect(searchRes.body.exactDepartures[0]).toMatchObject({
      routeLabel: expect.stringContaining("Nyali"),
      capacity: 14,
      availableSeats: expect.any(Number),
    });
    expect(Array.isArray(searchRes.body.suggestedTripRequests)).toBe(true);
  });

  it("returns 400 for invalid departures search date", async () => {
    const app = buildTestApp();
    await seedCoastCatalog();
    const token = await login(app);

    const res = await request(app)
      .get(
        "/api/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=nyali&date=02-06-2026",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });
});
