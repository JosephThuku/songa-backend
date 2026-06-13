/** Shared dev credentials and sample route (import-safe; no side effects). */

export const SEED_PASSWORD = "1234";

export const SAMPLE_PICKUP = {
  label: "JKIA Terminal 1A",
  lat: -1.3192,
  lng: 36.9278,
} as const;

export const SAMPLE_DROPOFF = {
  label: "Westlands",
  lat: -1.2674,
  lng: 36.807,
} as const;

export const SAMPLE_SEATS = [3, 4] as const;
