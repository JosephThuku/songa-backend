# Admin API

Admin routes require an authenticated user with `role: admin`.

## Ops routes

Base path: `/api/admin`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/users` | List users; filters: `q`, `role`, `page`, `limit` |
| `GET` | `/users/{id}` | User detail with counts/profile |
| `GET` | `/drivers` | List drivers; filters: `q`, `onboardingStatus`, `page`, `limit` |
| `GET` | `/drivers/{id}` | Driver detail with profile, vehicle, location |
| `PATCH` | `/drivers/{id}/status` | Update driver `onboardingStatus` |
| `GET` | `/bookings` | List bookings; filters: `status`, `product`, `passengerId`, `sharedDepartureId`, `page`, `limit` |
| `GET` | `/bookings/{id}` | Booking detail with passenger, latest payments, seats/departure |
| `GET` | `/rides` | List rides; filters: `phase`, `passengerId`, `driverId`, `prepaid`, `page`, `limit` |
| `GET` | `/rides/{id}` | Ride detail with passenger, driver, booking |
| `GET` | `/wallet-transactions` | List wallet rows; filters: `driverId`, `type`, `status`, `page`, `limit` |
| `GET` | `/cashouts` | List cashout requests; filters: `driverId`, `status`, `page`, `limit` |

## Shared rides catalog

Base path: `/api/admin/shared-rides`

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/corridor-locations` | Create corridor/zone |
| `PATCH` | `/corridor-locations/{id}` | Update corridor/zone coordinates, radius, active state |
| `DELETE` | `/corridor-locations/{id}` | Soft-delete corridor/zone |
| `POST` | `/sgr-schedule-slots` | Create timetable slot with `suggestedPricePerSeat` |
| `PATCH` | `/sgr-schedule-slots/{id}` | Update timetable and price |
| `DELETE` | `/sgr-schedule-slots/{id}` | Soft-delete slot |

`suggestedPricePerSeat` controls the default/future price for departures created from that slot.
Already-created departures keep their own `pricePerSeat`.
