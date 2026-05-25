/**
 * Simulates JKIA → Westlands booking with dummy places (writes debug-c61d17.log).
 * Run: npx tsx scripts/debug-booking-sim.ts
 */
import "dotenv/config";
import { getDummyPlaceById, searchDummyPlaces } from "../src/lib/dummy-places.js";
import { reversePlaceFromCatalog } from "../src/services/places.service.js";
import { searchRides } from "../src/services/ride-search.service.js";

const jkia = getDummyPlaceById("dummy_nairobi_jkia_t1a");
const westlands = getDummyPlaceById("dummy_nairobi_westlands");

console.log("JKIA search:", searchDummyPlaces({ query: "jkia" })[0]);
console.log("Reverse NYC coords as if browser GPS:", reversePlaceFromCatalog(40.7128, -74.006));

void searchRides({
  pickup: { label: jkia.name, lat: jkia.latitude, lng: jkia.longitude, placeId: jkia.place_id },
  dropoff: {
    label: westlands.name,
    lat: westlands.latitude,
    lng: westlands.longitude,
    placeId: westlands.place_id,
  },
}).then((r) => {
  console.log("Search options (JKIA→Westlands):", r.options.map((o) => ({ id: o.optionId, available: o.available })));
});
