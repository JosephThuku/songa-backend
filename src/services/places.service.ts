import { AppError } from "../lib/errors.js";
import {
  findNearestDummyPlaceWithDistance,
  getDummyPlaceById,
  placeFromGpsId,
  REVERSE_LABEL_MAX_KM,
  searchDummyPlaces,
  shouldUseDummyPlaces,
} from "../lib/dummy-places.js";
import {
  getGooglePlacesApiKey,
  googlePlacesKeyEnvHint,
} from "../lib/google-places-key.js";

const PLACES_API_BASE_URL = "https://places.googleapis.com/v1";

function placesApiKey(): string {
  const key = getGooglePlacesApiKey();
  if (!key) {
    throw new AppError("PLACES_NOT_CONFIGURED", 503, googlePlacesKeyEnvHint());
  }
  return key;
}

type LatLng = { latitude: number; longitude: number };

export type PlaceSuggestionDto = {
  placeId: string;
  name: string;
  secondaryText: string;
  fullAddress: string;
  distanceMeters?: number;
};

export type SelectedPlaceDto = {
  latitude: number;
  longitude: number;
  place_id: string;
  fullAddress: string;
  name: string;
};

type GoogleRpcError = {
  message?: string;
  status?: string;
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    place_id?: string;
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
  }>;
};

async function googlePlacesFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const apiKey = placesApiKey();
  const headers = new Headers(init.headers);
  headers.set("X-Goog-Api-Key", apiKey);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${PLACES_API_BASE_URL}${path}`, { ...init, headers });
}

function assertGoogleOk(
  response: Response,
  json: { error?: GoogleRpcError },
): void {
  if (!response.ok || json.error) {
    throw new AppError(
      "PLACES_UPSTREAM_ERROR",
      response.status >= 400 && response.status < 500 ? response.status : 502,
      json.error?.message ?? "Google Places request failed",
    );
  }
}

async function autocompleteGoogle(input: {
  input: string;
  sessionToken: string;
  origin?: LatLng | null;
}): Promise<PlaceSuggestionDto[]> {
  const body: Record<string, unknown> = {
    input: input.input,
    sessionToken: input.sessionToken,
    includeQueryPredictions: false,
    includedRegionCodes: ["ke"],
    languageCode: "en",
    regionCode: "ke",
  };

  if (input.origin) {
    body.origin = input.origin;
    body.locationBias = {
      circle: {
        center: input.origin,
        radius: 50000,
      },
    };
  }

  const response = await googlePlacesFetch("/places:autocomplete", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
        distanceMeters?: number;
      };
    }>;
    error?: GoogleRpcError;
  };

  assertGoogleOk(response, json);

  return (json.suggestions ?? [])
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction): prediction is NonNullable<typeof prediction> =>
      Boolean(prediction?.placeId),
    )
    .map((prediction) => ({
      placeId: prediction.placeId ?? "",
      name:
        prediction.structuredFormat?.mainText?.text ??
        prediction.text?.text ??
        "",
      secondaryText: prediction.structuredFormat?.secondaryText?.text ?? "",
      fullAddress:
        prediction.text?.text ??
        [
          prediction.structuredFormat?.mainText?.text,
          prediction.structuredFormat?.secondaryText?.text,
        ]
          .filter(Boolean)
          .join(", "),
      distanceMeters: prediction.distanceMeters,
    }));
}

async function getPlaceDetailsGoogle(input: {
  placeId: string;
  sessionToken: string;
}): Promise<SelectedPlaceDto> {
  const params = new URLSearchParams({ sessionToken: input.sessionToken });
  const response = await googlePlacesFetch(
    `/places/${encodeURIComponent(input.placeId)}?${params}`,
    {
      method: "GET",
      headers: {
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
    },
  );

  const json = (await response.json()) as {
    id?: string;
    formattedAddress?: string;
    displayName?: { text?: string };
    location?: LatLng;
    error?: GoogleRpcError;
  };

  assertGoogleOk(response, json);
  if (!json.location) {
    throw new AppError(
      "PLACES_UPSTREAM_ERROR",
      502,
      "Place details did not include coordinates.",
    );
  }

  return {
    latitude: json.location.latitude,
    longitude: json.location.longitude,
    place_id: json.id ?? input.placeId,
    fullAddress: json.formattedAddress ?? json.displayName?.text ?? "",
    name: json.displayName?.text ?? json.formattedAddress ?? "",
  };
}

export async function autocompletePlaces(input: {
  input: string;
  sessionToken: string;
  origin?: LatLng | null;
}): Promise<PlaceSuggestionDto[]> {
  if (shouldUseDummyPlaces()) {
    return searchDummyPlaces({
      query: input.input,
      origin: input.origin ?? null,
    });
  }

  return autocompleteGoogle(input);
}

export async function getPlaceDetails(input: {
  placeId: string;
  sessionToken: string;
}): Promise<SelectedPlaceDto> {
  const gpsPlace = placeFromGpsId(input.placeId);
  if (gpsPlace) return gpsPlace;

  if (shouldUseDummyPlaces()) {
    return getDummyPlaceById(input.placeId);
  }

  return getPlaceDetailsGoogle(input);
}

function displayNameFromGeocodeResult(
  result: NonNullable<GoogleGeocodeResponse["results"]>[number],
): string {
  const component = result.address_components?.find((part) =>
    part.types?.some((type) =>
      [
        "establishment",
        "point_of_interest",
        "sublocality",
        "neighborhood",
        "route",
      ].includes(type),
    ),
  );
  return component?.long_name ?? result.formatted_address ?? "Current location";
}

async function reversePlaceGoogle(
  lat: number,
  lng: number,
): Promise<SelectedPlaceDto> {
  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    key: placesApiKey(),
  });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
  );
  const json = (await response.json()) as GoogleGeocodeResponse;
  if (!response.ok || json.status !== "OK") {
    throw new AppError(
      "PLACES_UPSTREAM_ERROR",
      response.status >= 400 && response.status < 500 ? response.status : 502,
      json.error_message ??
        `Google reverse geocoding failed (${json.status ?? response.status})`,
    );
  }
  const result = json.results?.[0];
  if (!result?.formatted_address) {
    throw new AppError(
      "PLACES_UPSTREAM_ERROR",
      502,
      "Reverse geocoding did not include an address.",
    );
  }
  return {
    latitude: lat,
    longitude: lng,
    place_id: result.place_id ?? `gps_${lat.toFixed(5)}_${lng.toFixed(5)}`,
    name: displayNameFromGeocodeResult(result),
    fullAddress: result.formatted_address,
  };
}

/** Resolve device GPS to a friendly label without using the dummy catalog unless explicitly enabled. */
export async function reversePlace(
  lat: number,
  lng: number,
): Promise<SelectedPlaceDto> {
  if (!shouldUseDummyPlaces()) {
    return reversePlaceGoogle(lat, lng);
  }

  const nearest = findNearestDummyPlaceWithDistance(lat, lng);
  const useCatalogLabel = nearest && nearest.distanceKm <= REVERSE_LABEL_MAX_KM;
  if (useCatalogLabel && nearest) {
    return {
      latitude: lat,
      longitude: lng,
      place_id: `gps_${lat.toFixed(5)}_${lng.toFixed(5)}`,
      name: nearest.place.name,
      fullAddress: nearest.place.fullAddress,
    };
  }
  return {
    latitude: lat,
    longitude: lng,
    place_id: `gps_${lat.toFixed(5)}_${lng.toFixed(5)}`,
    name: "Current location",
    fullAddress: `Near ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  };
}

export { shouldUseDummyPlaces };
