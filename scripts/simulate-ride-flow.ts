/**
 * End-to-end ride simulator for local dev: passenger request → driver accept →
 * animated GPS toward pickup (driver_en_route / driver_arriving) → arrived →
 * trip to dropoff → complete.
 *
 * Run with the API up (default http://localhost:4000):
 *   npm run simulate:ride
 *
 * Open two browser tabs on Expo web before/during the run:
 *   - Passenger: +254712000001 / SongaDev1 — stay on the Home tab (tracking opens automatically)
 *   - Driver:    +254712345678 / SongaDev1 (James Mwangi), go Online
 *
 * Env: API_URL, STEP_MS (default 2500), PASSENGER_PHONE, DRIVER_PHONE
 */
import "dotenv/config";
import {
  SAMPLE_DROPOFF,
  SAMPLE_PICKUP,
  SEED_PASSWORD,
} from "../prisma/seed-constants.js";

const API = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const STEP_MS = Number.parseInt(process.env.STEP_MS ?? "2500", 10);
const PASSENGER_PHONE = process.env.PASSENGER_PHONE ?? "+254712000001";
const DRIVER_PHONE = process.env.DRIVER_PHONE ?? "+254712345678";

type Role = "passenger" | "driver";

type RideSnapshot = {
  id: string;
  phase: string;
  etaMinutes: number;
  distanceKm: number;
  driverLocation?: { lat: number; lng: number } | null;
};

type LatLng = { lat: number; lng: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolatePath(from: LatLng, to: LatLng, steps: number): LatLng[] {
  const points: LatLng[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    points.push({
      lat: lerp(from.lat, to.lat, t),
      lng: lerp(from.lng, to.lng, t),
    });
  }
  return points;
}

async function api<T>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  }
  return data as T;
}

async function login(phone: string, role: Role): Promise<string> {
  const result = await api<{ sessionToken: string }>("/api/auth/login", {
    method: "POST",
    body: { identifier: phone, password: SEED_PASSWORD, role },
  });
  return result.sessionToken;
}

async function getActiveRide(token: string): Promise<RideSnapshot | null> {
  const result = await api<{ ride: RideSnapshot | null }>("/api/rides/active", { token });
  return result.ride;
}

/** Must match backend CANCEL_LABELS exactly (ride.service.ts). */
const DEV_CANCEL_BODY = {
  reasonId: "plans_changed",
  reasonLabel: "My plans changed",
  detail: null,
} as const;

const PASSENGER_CANCELLABLE_PHASES = new Set([
  "finding_driver",
  "driver_accepted",
  "driver_en_route",
  "driver_arriving",
]);

async function finishRideAsDriver(driverToken: string, rideId: string, phase: string): Promise<void> {
  if (["driver_accepted", "driver_en_route", "driver_arriving"].includes(phase)) {
    await api(`/api/rides/${rideId}/arrived`, { method: "POST", token: driverToken });
    phase = "driver_arrived";
  }
  if (phase === "driver_arrived") {
    await api(`/api/rides/${rideId}/start`, { method: "POST", token: driverToken });
    phase = "trip_in_progress";
  }
  if (phase === "trip_in_progress") {
    await api(`/api/rides/${rideId}/complete`, { method: "POST", token: driverToken });
  }
}

/** Clears leftover rides from a previous interrupted simulate:ride run. */
async function clearStaleRides(passengerToken: string, driverToken: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ride = await getActiveRide(passengerToken);
    if (!ride || ride.phase === "trip_ended" || ride.phase === "cancelled") break;

    console.log(`Clearing stale ride ${ride.id} (${ride.phase})…`);

    if (PASSENGER_CANCELLABLE_PHASES.has(ride.phase)) {
      await api(`/api/rides/${ride.id}/cancel`, {
        method: "POST",
        token: passengerToken,
        body: DEV_CANCEL_BODY,
      });
      console.log("  → cancelled");
      continue;
    }

    await finishRideAsDriver(driverToken, ride.id, ride.phase);
    console.log("  → completed via driver");
  }

  const driverRide = await getActiveRide(driverToken);
  if (
    driverRide &&
    driverRide.phase !== "trip_ended" &&
    driverRide.phase !== "cancelled"
  ) {
    console.log(`Clearing driver active ride ${driverRide.id} (${driverRide.phase})…`);
    await finishRideAsDriver(driverToken, driverRide.id, driverRide.phase);
    console.log("  → completed via driver");
  }
}

async function postDriverLocation(token: string, point: LatLng): Promise<void> {
  await api<void>("/api/drivers/me/location", {
    method: "POST",
    token,
    body: { lat: point.lat, lng: point.lng, recordedAt: new Date().toISOString() },
  });
}

async function ensureDriverOnline(token: string): Promise<void> {
  await api("/api/drivers/me/online", {
    method: "PATCH",
    token,
    body: { isOnline: true },
  });
}

function formatRide(label: string, ride: RideSnapshot | null): void {
  if (!ride) {
    console.log(`  ${label}: (no active ride)`);
    return;
  }
  const loc = ride.driverLocation;
  const locStr =
    loc && typeof loc.lat === "number"
      ? ` @ ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`
      : "";
  console.log(
    `  ${label}: phase=${ride.phase} eta=${ride.etaMinutes}min dist=${ride.distanceKm}km${locStr}`,
  );
}

async function logBoth(
  passengerToken: string,
  driverToken: string,
  step: string,
): Promise<RideSnapshot | null> {
  console.log(`\n── ${step} ──`);
  const passengerRide = await getActiveRide(passengerToken);
  const driverRide = await getActiveRide(driverToken);
  formatRide("passenger", passengerRide);
  formatRide("driver", driverRide);
  return passengerRide;
}

async function animateDriver(
  driverToken: string,
  passengerToken: string,
  from: LatLng,
  to: LatLng,
  steps: number,
  label: string,
): Promise<void> {
  const path = interpolatePath(from, to, steps);
  for (let i = 0; i < path.length; i += 1) {
    await postDriverLocation(driverToken, path[i]!);
    await sleep(STEP_MS);
    const ride = await logBoth(passengerToken, driverToken, `${label} (${i + 1}/${path.length})`);
    if (ride?.phase === "driver_arriving") {
      console.log("  ✓ Passenger should show: Driver is arriving");
    }
    if (ride?.phase === "trip_in_progress" && label.includes("dropoff")) {
      console.log("  ✓ Passenger should show: On the way to destination");
    }
  }
}

async function main(): Promise<void> {
  const pickup: LatLng = { lat: SAMPLE_PICKUP.lat, lng: SAMPLE_PICKUP.lng };
  const dropoff: LatLng = { lat: SAMPLE_DROPOFF.lat, lng: SAMPLE_DROPOFF.lng };

  // ~8 km southeast of JKIA — keeps phase on driver_en_route until we animate closer.
  const farFromPickup: LatLng = { lat: -1.355, lng: 37.02 };
  const nearPickup: LatLng = { lat: pickup.lat + 0.0015, lng: pickup.lng + 0.0015 };

  console.log("Songa ride flow simulator");
  console.log(`API: ${API}  step: ${STEP_MS}ms`);
  console.log("\nLog in on Expo web (two windows / profiles):");
  console.log(`  Passenger  ${PASSENGER_PHONE}  /  ${SEED_PASSWORD}`);
  console.log(`  Driver     ${DRIVER_PHONE}  /  ${SEED_PASSWORD}  (toggle Online on driver home)`);
  console.log("  Passenger must be logged in on Expo **Home** — tracking sheet opens when the ride starts.\n");
  console.log(`  Route: ${SAMPLE_PICKUP.label} → ${SAMPLE_DROPOFF.label}\n`);

  const health = await fetch(`${API}/api/health`);
  if (!health.ok) {
    throw new Error(`Backend not reachable at ${API} — run: cd songa-backend && npm run dev`);
  }

  const passengerToken = await login(PASSENGER_PHONE, "passenger");
  const driverToken = await login(DRIVER_PHONE, "driver");
  console.log("Authenticated.");

  await clearStaleRides(passengerToken, driverToken);
  await sleep(400);

  await ensureDriverOnline(driverToken);
  await postDriverLocation(driverToken, farFromPickup);
  console.log("Driver online, positioned far from pickup.");

  const requested = await api<{ ride: RideSnapshot }>("/api/rides/request", {
    method: "POST",
    token: passengerToken,
    body: {
      pickup: { label: SAMPLE_PICKUP.label, lat: pickup.lat, lng: pickup.lng },
      dropoff: { label: SAMPLE_DROPOFF.label, lat: dropoff.lat, lng: dropoff.lng },
      seats: [3, 4],
      optionId: "car",
      prepaid: false,
      paymentMethod: null,
    },
  });
  const rideId = requested.ride.id;
  console.log(`\nRide requested: ${rideId} (finding_driver)`);
  console.log("  → Driver app: accept the incoming offer if the sheet is open.");

  await sleep(STEP_MS);
  const accepted = await api<{ ride: RideSnapshot }>(`/api/rides/${rideId}/accept`, {
    method: "POST",
    token: driverToken,
  });
  console.log(`Driver accepted → ${accepted.ride.phase}`);
  await logBoth(passengerToken, driverToken, "after accept");
  console.log("  ✓ Passenger should show: Pickup in X min");

  await animateDriver(
    driverToken,
    passengerToken,
    farFromPickup,
    nearPickup,
    6,
    "Driving to pickup",
  );

  const arrived = await api<{ ride: RideSnapshot }>(`/api/rides/${rideId}/arrived`, {
    method: "POST",
    token: driverToken,
  });
  console.log(`\nDriver marked arrived → ${arrived.ride.phase}`);
  await logBoth(passengerToken, driverToken, "at pickup");

  const started = await api<{ ride: RideSnapshot }>(`/api/rides/${rideId}/start`, {
    method: "POST",
    token: driverToken,
  });
  console.log(`Trip started → ${started.ride.phase}`);

  await postDriverLocation(driverToken, nearPickup);
  await sleep(STEP_MS);

  await animateDriver(
    driverToken,
    passengerToken,
    nearPickup,
    dropoff,
    8,
    "Driving to dropoff",
  );

  const completed = await api<{ ride: RideSnapshot }>(`/api/rides/${rideId}/complete`, {
    method: "POST",
    token: driverToken,
  });
  console.log(`\nTrip completed → ${completed.ride.phase}`);
  await logBoth(passengerToken, driverToken, "finished");

  console.log("\nDone. Passenger can rate the trip; driver returns to online home.");
  console.log("\nRe-run: npm run simulate:ride");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
