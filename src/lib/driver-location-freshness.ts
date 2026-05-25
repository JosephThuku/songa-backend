/** How long a driver's last GPS ping counts as "fresh" for dispatch / nearby search. */
export function driverLocationFreshWindowMs(): number {
  if (process.env.DRIVER_LOCATION_FRESH_MS) {
    return Number(process.env.DRIVER_LOCATION_FRESH_MS);
  }
  // Local dev (NODE_ENV often unset): seeded drivers stay bookable without live GPS pings.
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    return 24 * 60 * 60 * 1000;
  }
  return 60_000;
}

export function driverLocationFreshSince(): Date {
  return new Date(Date.now() - driverLocationFreshWindowMs());
}
