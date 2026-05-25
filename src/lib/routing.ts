import { loadEnv } from "../config/env.js";
import {
  estimateDrivingMinutes,
  estimatePickupEtaMinutes,
  haversineDistanceKm,
  type LatLng,
} from "./geo.js";
import { getRedis } from "./redis.js";

const ROUTE_CACHE_TTL_SEC = 300;
const GOOGLE_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

export type RoutePoint = { lat: number; lng: number };

export type RoutePlan = {
  distanceKm: number;
  durationMinutes: number;
  durationInTrafficMinutes: number;
  polyline: RoutePoint[];
  summary: string;
  provider: "google" | "estimate";
  traffic: "live" | "typical" | "none";
};

function mapsApiKey(): string | null {
  const key =
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    "";
  return key.length > 0 ? key : null;
}

function cacheKey(origin: LatLng, destination: LatLng): string {
  const r = (n: number) => n.toFixed(4);
  return `route:${r(origin.lat)}:${r(origin.lng)}:${r(destination.lat)}:${r(destination.lng)}`;
}

function estimateRoute(origin: LatLng, destination: LatLng): RoutePlan {
  const distanceKm = haversineDistanceKm(origin, destination);
  const durationMinutes = estimateDrivingMinutes(distanceKm);
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes,
    durationInTrafficMinutes: durationMinutes,
    polyline: [origin, destination],
    summary: "Fastest route (estimated)",
    provider: "estimate",
    traffic: "typical",
  };
}

/** Decode Google encoded polyline to lat/lng points. */
export function decodeEncodedPolyline(encoded: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

type GoogleDirectionsResponse = {
  status: string;
  routes?: Array<{
    summary?: string;
    legs?: Array<{
      distance?: { value: number };
      duration?: { value: number };
      duration_in_traffic?: { value: number };
    }>;
    overview_polyline?: { points?: string };
  }>;
};

async function fetchGoogleRoute(origin: LatLng, destination: LatLng): Promise<RoutePlan | null> {
  const key = mapsApiKey();
  if (!key) return null;

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    key,
    mode: "driving",
    departure_time: "now",
    traffic_model: "best_guess",
    alternatives: "false",
  });

  const response = await fetch(`${GOOGLE_DIRECTIONS_URL}?${params.toString()}`);
  if (!response.ok) return null;

  const data = (await response.json()) as GoogleDirectionsResponse;
  if (data.status !== "OK" || !data.routes?.[0]) return null;

  const route = data.routes[0];
  const leg = route.legs?.[0];
  if (!leg?.distance?.value || !leg.duration?.value) return null;

  const encoded = route.overview_polyline?.points ?? "";
  const polyline = encoded ? decodeEncodedPolyline(encoded) : [origin, destination];
  const distanceKm = leg.distance.value / 1000;
  const durationMinutes = Math.max(1, Math.round(leg.duration.value / 60));
  const trafficSec = leg.duration_in_traffic?.value ?? leg.duration.value;
  const durationInTrafficMinutes = Math.max(1, Math.round(trafficSec / 60));

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes,
    durationInTrafficMinutes,
    polyline: polyline.length > 0 ? polyline : [origin, destination],
    summary: route.summary?.trim() || "Recommended route",
    provider: "google",
    traffic: leg.duration_in_traffic ? "live" : "typical",
  };
}

/**
 * Best driving route from origin → destination.
 * Uses Google Directions (traffic-aware) when API key is set; otherwise haversine estimate.
 */
export async function getDrivingRoute(origin: LatLng, destination: LatLng): Promise<RoutePlan> {
  loadEnv();
  const redis = getRedis();
  const key = cacheKey(origin, destination);
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as RoutePlan;
    } catch {
      /* fall through */
    }
  }

  let plan: RoutePlan;
  try {
    plan = (await fetchGoogleRoute(origin, destination)) ?? estimateRoute(origin, destination);
  } catch {
    plan = estimateRoute(origin, destination);
  }

  await redis.set(key, JSON.stringify(plan), { pxMs: ROUTE_CACHE_TTL_SEC * 1000 });
  return plan;
}

/** ETA minutes for driver → pickup (uses traffic duration when available). */
export async function etaMinutesForDistance(
  origin: LatLng,
  destination: LatLng,
): Promise<{ etaMinutes: number; distanceKm: number; plan: RoutePlan }> {
  const plan = await getDrivingRoute(origin, destination);
  const etaMinutes =
    plan.provider === "google"
      ? plan.durationInTrafficMinutes
      : estimatePickupEtaMinutes(plan.distanceKm);
  return { etaMinutes, distanceKm: plan.distanceKm, plan };
}
