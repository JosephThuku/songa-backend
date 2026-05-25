/**
 * Logs driver supply for JKIA and Mombasa pickups (writes debug-c61d17.log).
 * Run: npx tsx scripts/debug-driver-supply.ts
 */
import "dotenv/config";
import { findDriversNearPickup } from "../src/services/driver.service.js";
import { driverLocationFreshWindowMs } from "../src/lib/driver-location-freshness.js";

const jkia = { lat: -1.3192, lng: 36.9278 };
const mombasaAirport = { lat: -4.0348, lng: 39.5942 };

console.log("fresh window ms:", driverLocationFreshWindowMs(), "NODE_ENV:", process.env.NODE_ENV);

const jkiaDrivers = await findDriversNearPickup({ pickup: jkia, limit: 5 });
console.log("JKIA drivers:", jkiaDrivers.length, jkiaDrivers[0]?.name);

const mombasaDrivers = await findDriversNearPickup({ pickup: mombasaAirport, limit: 5 });
console.log("Mombasa drivers:", mombasaDrivers.length, mombasaDrivers[0]?.name);
