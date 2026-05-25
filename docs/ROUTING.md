# Driving routes & traffic-aware ETAs

## Recommended provider (production)

**Google Maps Platform — Directions API** is the best fit for Songa in Nairobi:

- Road-following routes (not straight lines)
- **`duration_in_traffic`** with `departure_time=now` and `traffic_model=best_guess`
- Strong Kenya coverage (Uber/Bolt-class behaviour)
- Same API key as Places Autocomplete

Enable **Directions API** on your Google Cloud project and set:

```env
GOOGLE_MAPS_API_KEY=your_key
# or reuse:
GOOGLE_PLACES_API_KEY=your_key
```

Without a key, the backend falls back to **haversine distance + urban speed estimates** (~27–30 km/h).

## Alternatives

| Provider | Traffic | Notes |
|----------|---------|--------|
| **Mapbox Directions** | Yes (`driving-traffic`) | Good maps; separate billing |
| **HERE Routing** | Yes | Strong fleet tools |
| **OSRM / Valhalla** | No live traffic | Free self-host; dev only |

## Backend behaviour

- `POST /api/drivers/me/location` — every ~10s updates Redis GEO + ride `etaMinutes` / `distanceKm` using routed ETA when possible.
- Phases tracked: pickup leg (`driver_accepted` → `driver_arriving`) and trip leg (`trip_in_progress` → drop-off).
- `GET /api/rides/:rideId/navigation` — route polyline, traffic ETA, summary, `mapsUrl` for Google Maps turn-by-turn.
- Routes cached in Redis for 5 minutes per origin/destination pair.

## Mobile

- Driver map draws the route polyline (Leaflet web / `react-native-maps` native).
- ETAs display as **`1hr2min`** via `formatDurationHrMin()`.
- **Open in Google Maps** uses the navigation `mapsUrl` from the API.
