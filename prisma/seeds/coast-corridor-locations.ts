/**
 * Corridor zone centers for GPS resolve (approximate town / landmark centers).
 * Sources: OpenStreetMap / Wikipedia (SGR Mombasa Terminus, Miritini).
 * Re-verify on map before tightening radiusM for production polygon checks.
 */

export type CoastCorridorSeed = {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  sortOrder: number;
};

/** Mombasa SGR Terminus (Miritini) — Wikipedia 4°01′18″S 39°34′46″E */
export const SGR_MIRITINI: CoastCorridorSeed = {
  slug: "sgr-miritini",
  name: "SGR Miritini",
  lat: -4.02178,
  lng: 39.57947,
  radiusM: 1200,
  sortOrder: 0,
};

export const COAST_CORRIDOR_ZONES: readonly CoastCorridorSeed[] = [
  {
    slug: "mtwapa",
    name: "Mtwapa",
    lat: -3.9436,
    lng: 39.7433,
    radiusM: 3000,
    sortOrder: 10,
  },
  {
    slug: "nyali",
    name: "Nyali",
    lat: -4.0207,
    lng: 39.7199,
    radiusM: 3500,
    sortOrder: 20,
  },
  {
    slug: "bamburi",
    name: "Bamburi",
    lat: -3.9964,
    lng: 39.7578,
    radiusM: 3000,
    sortOrder: 30,
  },
  {
    slug: "mombasa-cbd",
    name: "Mombasa CBD",
    lat: -4.0594,
    lng: 39.6636,
    radiusM: 4000,
    sortOrder: 40,
  },
  {
    slug: "diani",
    name: "Diani",
    lat: -4.2931,
    lng: 39.584,
    radiusM: 6000,
    sortOrder: 50,
  },
] as const;
