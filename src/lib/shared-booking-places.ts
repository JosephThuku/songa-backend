import type { PlacePersistInput } from "./place-persist.js";
import type { PlaceDto } from "./responses.js";

const SGR_CORRIDOR_SLUG = "sgr-miritini";

type CorridorRef = {
  id: string;
  slug: string;
};

type DepartureCorridors = {
  pickupLocationId: string;
  dropoffLocationId: string;
  pickupLocation: CorridorRef;
  dropoffLocation: CorridorRef;
};

/** Attach corridor catalog ids when a shared booking place maps to a zone or SGR stop. */
export function sharedBookingPlaceInputs(
  departure: DepartureCorridors,
  pickupPlace: PlaceDto,
  dropoffPlace: PlaceDto,
  isToSgr: boolean,
): { pickup: PlacePersistInput; dropoff: PlacePersistInput } {
  const sgrLocationId =
    departure.pickupLocation.slug === SGR_CORRIDOR_SLUG
      ? departure.pickupLocationId
      : departure.dropoffLocationId;

  const pickupCorridorId = isToSgr ? departure.pickupLocationId : sgrLocationId;
  const dropoffCorridorId = isToSgr ? departure.dropoffLocationId : departure.dropoffLocationId;

  return {
    pickup: { ...pickupPlace, corridorLocationId: pickupCorridorId },
    dropoff: { ...dropoffPlace, corridorLocationId: dropoffCorridorId },
  };
}
