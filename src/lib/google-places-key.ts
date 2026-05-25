/** Resolve Google Places API key from server env (supports common copy-paste mistakes in dev). */
export function getGooglePlacesApiKey(): string | null {
  const names = [
    "GOOGLE_PLACES_API_KEY",
    "GOOGLE_MAPS_API_KEY",
    "EXPO_PUBLIC_GOOGLE_PLACES_API_KEY",
  ] as const;

  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return null;
}

export function googlePlacesKeyEnvHint(): string {
  return "Set GOOGLE_PLACES_API_KEY in songa-backend/.env (same value as EXPO_PUBLIC_GOOGLE_PLACES_API_KEY in the mobile app).";
}
