import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { haversineDistanceKm } from "./geo.js";
import { AppError } from "./errors.js";
import { getGooglePlacesApiKey } from "./google-places-key.js";

export type DummyPlaceRecord = {
  placeId: string;
  name: string;
  secondaryText: string;
  fullAddress: string;
  city: string;
  latitude: number;
  longitude: number;
  keywords: string[];
};

type DummyPlacesFile = { places: DummyPlaceRecord[] };

let cachedPlaces: DummyPlaceRecord[] | null = null;
const byId = new Map<string, DummyPlaceRecord>();

function dataPath(): string {
  const fromModule = join(dirname(fileURLToPath(import.meta.url)), "../../data/dummy-places.json");
  if (existsSync(fromModule)) return fromModule;
  const fromCwd = join(process.cwd(), "data/dummy-places.json");
  if (existsSync(fromCwd)) return fromCwd;
  return fromModule;
}

export function loadDummyPlaces(): DummyPlaceRecord[] {
  if (cachedPlaces) return cachedPlaces;
  const raw = readFileSync(dataPath(), "utf8");
  const parsed = JSON.parse(raw) as DummyPlacesFile;
  cachedPlaces = parsed.places;
  byId.clear();
  for (const place of cachedPlaces) {
    byId.set(place.placeId, place);
  }
  return cachedPlaces;
}

/** Dev autocomplete without Google. Default dummy in development unless USE_GOOGLE_PLACES=true. */
export function shouldUseDummyPlaces(): boolean {
  if (process.env.USE_DUMMY_PLACES === "true") return true;
  if (process.env.USE_DUMMY_PLACES === "false") return false;
  if (process.env.USE_GOOGLE_PLACES === "true" && getGooglePlacesApiKey()) return false;
  if (process.env.NODE_ENV === "production") return !getGooglePlacesApiKey();
  return true;
}

/** Only use a catalog name for GPS/reverse when the user is this close (km). */
export const REVERSE_LABEL_MAX_KM = 25;

const REGION_ANCHORS = {
  nairobi: { lat: -1.2864, lng: 36.8172 },
  mombasa: { lat: -4.0435, lng: 39.7189 },
} as const;

const REGION_RADIUS_KM = 250;

const MOMBASA_QUERY = /\b(mombasa|moi|nyali|diani|bamburi|likoni|makadara|miritini)\b/i;
const NAIROBI_QUERY = /\b(nairobi|jkia|westlands|karen|sgr|wilson|umoja|gigiri|garden|cbd|kenyatta)\b/i;

/** Prefer Nairobi vs Mombasa catalog entries based on user position or explicit query. */
export function inferCatalogCityFromCoords(lat: number, lng: number): "nairobi" | "mombasa" | null {
  const toNairobi = haversineDistanceKm({ lat, lng }, REGION_ANCHORS.nairobi);
  const toMombasa = haversineDistanceKm({ lat, lng }, REGION_ANCHORS.mombasa);
  if (toNairobi <= REGION_RADIUS_KM && toNairobi <= toMombasa) return "nairobi";
  if (toMombasa <= REGION_RADIUS_KM && toMombasa < toNairobi) return "mombasa";
  return null;
}

function catalogCityForSearch(query: string, origin?: { latitude: number; longitude: number } | null): string | null {
  if (MOMBASA_QUERY.test(query)) return "mombasa";
  if (NAIROBI_QUERY.test(query)) return "nairobi";
  if (origin) return inferCatalogCityFromCoords(origin.latitude, origin.longitude);
  return "nairobi";
}

function matchScore(place: DummyPlaceRecord, query: string): number {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return 0;

  const haystacks = [
    place.name,
    place.secondaryText,
    place.fullAddress,
    place.city,
    ...place.keywords,
  ].map((s) => s.toLowerCase());

  if (haystacks.some((h) => h === q)) return 100;
  if (haystacks.some((h) => h.startsWith(q))) return 80;
  if (haystacks.some((h) => h.includes(q))) return 60;
  if (q.includes(" ") && place.keywords.some((k) => q.includes(k))) return 40;
  return 0;
}

export function searchDummyPlaces(input: {
  query: string;
  origin?: { latitude: number; longitude: number } | null;
  limit?: number;
}): Array<{
  placeId: string;
  name: string;
  secondaryText: string;
  fullAddress: string;
  distanceMeters?: number;
}> {
  const q = input.query.trim();
  if (q.length < 2) return [];

  const places = loadDummyPlaces();
  const cityFilter = catalogCityForSearch(q, input.origin ?? null);
  const scored = places
    .map((place) => ({ place, score: matchScore(place, q) }))
    .filter((row) => row.score > 0)
    .filter((row) => !cityFilter || row.place.city === cityFilter);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (input.origin) {
      const aKm = haversineDistanceKm(
        { lat: input.origin.latitude, lng: input.origin.longitude },
        { lat: a.place.latitude, lng: a.place.longitude },
      );
      const bKm = haversineDistanceKm(
        { lat: input.origin.latitude, lng: input.origin.longitude },
        { lat: b.place.latitude, lng: b.place.longitude },
      );
      return aKm - bKm;
    }
    return a.place.name.localeCompare(b.place.name);
  });

  const limit = input.limit ?? 8;
  return scored.slice(0, limit).map(({ place }) => {
    let distanceMeters: number | undefined;
    if (input.origin) {
      const km = haversineDistanceKm(
        { lat: input.origin.latitude, lng: input.origin.longitude },
        { lat: place.latitude, lng: place.longitude },
      );
      distanceMeters = Math.round(km * 1000);
    }
    return {
      placeId: place.placeId,
      name: place.name,
      secondaryText: place.secondaryText,
      fullAddress: place.fullAddress,
      distanceMeters,
    };
  });
}

const GPS_PLACE_ID = /^gps_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/;

export function placeFromGpsId(placeId: string): {
  latitude: number;
  longitude: number;
  place_id: string;
  fullAddress: string;
  name: string;
} | null {
  const match = GPS_PLACE_ID.exec(placeId);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const nearest = findNearestDummyPlaceWithDistance(latitude, longitude);
  if (nearest && nearest.distanceKm <= REVERSE_LABEL_MAX_KM) {
    return {
      latitude,
      longitude,
      place_id: placeId,
      name: nearest.place.name,
      fullAddress: nearest.place.fullAddress,
    };
  }
  return {
    latitude,
    longitude,
    place_id: placeId,
    name: "Current location",
    fullAddress: `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
  };
}

export function findNearestDummyPlaceWithDistance(
  lat: number,
  lng: number,
): { place: DummyPlaceRecord; distanceKm: number } | null {
  const places = loadDummyPlaces();
  if (places.length === 0) return null;
  let best = places[0]!;
  let bestKm = haversineDistanceKm({ lat, lng }, { lat: best.latitude, lng: best.longitude });
  for (const place of places.slice(1)) {
    const km = haversineDistanceKm({ lat, lng }, { lat: place.latitude, lng: place.longitude });
    if (km < bestKm) {
      best = place;
      bestKm = km;
    }
  }
  return { place: best, distanceKm: bestKm };
}

/** Nearest catalog place (for labels / suggestions near the user). */
export function findNearestDummyPlace(lat: number, lng: number): DummyPlaceRecord | null {
  return findNearestDummyPlaceWithDistance(lat, lng)?.place ?? null;
}

export function getDummyPlaceById(placeId: string): {
  latitude: number;
  longitude: number;
  place_id: string;
  fullAddress: string;
  name: string;
} {
  loadDummyPlaces();
  const place = byId.get(placeId);
  if (!place) {
    throw new AppError("PLACE_NOT_FOUND", 404, `Unknown dummy place: ${placeId}`);
  }
  return {
    latitude: place.latitude,
    longitude: place.longitude,
    place_id: place.placeId,
    fullAddress: place.fullAddress,
    name: place.name,
  };
}
