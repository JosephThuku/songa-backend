/**
 * Diagnose Mombasa dispatch: Danka Plaza (Links Rd) → Ratna Square Nyali.
 * Does driver Aly receive an offer? (read-only — does not change driver GPS)
 *
 * Run: npx tsx scripts/debug-mombasa-aly-dispatch.ts
 */
import "dotenv/config";
import { PrismaClient, RidePhase } from "@prisma/client";
import { driverLocationFreshSince, driverLocationFreshWindowMs } from "../src/lib/driver-location-freshness.js";
import { haversineDistanceKm } from "../src/lib/geo.js";
import { findDriversNearPickup } from "../src/services/driver.service.js";

const ALY_USER_ID = "usr_cmpplk6m20000klioagoz0cdz";

/** Danka Plaza area, Links Road Nyali / Mombasa */
const PICKUP = {
  label: "Danka Plaza, Links Road, Mombasa",
  lat: -4.0432,
  lng: 39.7158,
};

/** Ratna Square, Nyali */
const DROPOFF = {
  label: "Ratna Square, Nyali, Mombasa",
  lat: -4.045,
  lng: 39.683,
};

const prisma = new PrismaClient();

function toPoint(value: unknown): { lat: number; lng: number } | null {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  if (!object || typeof object.lat !== "number" || typeof object.lng !== "number") return null;
  return { lat: object.lat, lng: object.lng };
}

async function simulateDispatchOffers(pickup: { lat: number; lng: number }) {
  const freshSince = driverLocationFreshSince();
  const profiles = await prisma.driverProfile.findMany({
    where: {
      isOnline: true,
      onboardingStatus: "approved",
      locationUpdatedAt: { gte: freshSince },
      vehicleId: { not: null },
      vehicle: { type: "Car" },
    },
    include: { user: true, vehicle: true },
  });

  const candidates: { userId: string; name: string | null; distanceKm: number }[] = [];
  for (const profile of profiles) {
    const active = await prisma.ride.findFirst({
      where: { driverId: profile.userId, phase: { notIn: [RidePhase.trip_ended, RidePhase.cancelled] } },
      select: { id: true },
    });
    if (active) continue;
    const location = toPoint(profile.location);
    if (!location) continue;
    candidates.push({
      userId: profile.userId,
      name: profile.user.name,
      distanceKm: haversineDistanceKm(pickup, location),
    });
  }
  candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  return candidates.slice(0, 5);
}

async function main() {
  const aly = await prisma.user.findUnique({
    where: { id: ALY_USER_ID },
    include: { driverProfile: { include: { vehicle: true } } },
  });

  if (!aly?.driverProfile) {
    console.error("Aly driver profile not found.");
    process.exit(1);
  }

  const dp = aly.driverProfile;
  const loc = toPoint(dp.location);
  const freshSince = driverLocationFreshSince();
  const freshMs = driverLocationFreshWindowMs();

  console.log("=== Aly Mtsumi (current DB) ===");
  console.log({
    isOnline: dp.isOnline,
    onboardingStatus: dp.onboardingStatus,
    vehicleStatus: dp.vehicle?.status,
    vehicleType: dp.vehicle?.type,
    location: loc,
    locationUpdatedAt: dp.locationUpdatedAt?.toISOString(),
    locationFresh: dp.locationUpdatedAt ? dp.locationUpdatedAt >= freshSince : false,
    freshWindowMs: freshMs,
  });

  console.log("\n=== Trip ===");
  console.log({ pickup: PICKUP, dropoff: DROPOFF });
  console.log("Trip distance km:", haversineDistanceKm(PICKUP, DROPOFF).toFixed(2));

  if (loc) {
    console.log("Aly distance to pickup km:", haversineDistanceKm(PICKUP, loc).toFixed(2));
  }

  const nearby = await findDriversNearPickup({ pickup: PICKUP, vehicleType: "Car", radiusKm: 25, limit: 10 });
  console.log("\n=== findDriversNearPickup (Car, 25km) ===");
  console.log(
    nearby.map((d) => ({
      driverId: d.driverId,
      name: d.name,
      pickupDistanceKm: d.pickupDistanceKm,
      isAly: d.driverId === ALY_USER_ID,
    })),
  );

  const dispatchTop5 = await simulateDispatchOffers(PICKUP);
  console.log("\n=== dispatchRideOffers simulation (top 5, Car) ===");
  console.log(
    dispatchTop5.map((d) => ({
      ...d,
      isAly: d.userId === ALY_USER_ID,
      wouldGetOffer: dispatchTop5.some((c) => c.userId === ALY_USER_ID),
    })),
  );

  const alyInNearby = nearby.some((d) => d.driverId === ALY_USER_ID);
  const alyInDispatch = dispatchTop5.some((d) => d.userId === ALY_USER_ID);

  console.log("\n=== Verdict ===");
  console.log({
    alyEligibleProfile:
      dp.isOnline &&
      dp.onboardingStatus === "approved" &&
      dp.vehicle?.status === "Activated" &&
      Boolean(dp.vehicleId),
    alyLocationFresh: dp.locationUpdatedAt ? dp.locationUpdatedAt >= freshSince : false,
    alyInNearbySearch: alyInNearby,
    alyWouldReceiveOffer: alyInDispatch,
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
