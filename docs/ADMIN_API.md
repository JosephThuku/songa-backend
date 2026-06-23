# Admin API

Admin routes require an authenticated user with `role: admin`.

Blocked users (`isBlocked: true`) cannot use any authenticated route; sessions are revoked when an admin blocks or deactivates an account.

## Ops routes

Base path: `/api/admin`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/users` | List users; filters: `q`, `role`, `isBlocked`, `page`, `limit` |
| `GET` | `/users/{id}` | User detail with counts/profile |
| `PATCH` | `/users/{id}` | Update `name`, `email`, or `isBlocked` (block/unblock) |
| `DELETE` | `/users/{id}` | Deactivate user (sets `isBlocked: true`, revokes sessions; drivers go offline) |
| `GET` | `/passengers` | List passengers (`role=passenger` shortcut); same filters as `/users` |
| `GET` | `/passengers/{id}` | Passenger detail with booking counts and recent bookings |
| `GET` | `/drivers` | List drivers; filters: `q`, `onboardingStatus`, `page`, `limit` |
| `GET` | `/drivers/{id}` | Driver detail with profile, vehicle, location |
| `PATCH` | `/drivers/{id}/status` | Update driver `onboardingStatus` |
| `GET` | `/bookings` | List bookings; filters: `status`, `product`, `passengerId`, `sharedDepartureId`, `page`, `limit` |
| `GET` | `/bookings/{id}` | Booking detail with passenger, latest payments, seats/departure |
| `GET` | `/rides` | List rides; filters: `phase`, `passengerId`, `driverId`, `prepaid`, `page`, `limit` |
| `GET` | `/rides/{id}` | Ride detail with passenger, driver, booking |
| `GET` | `/wallet-transactions` | List wallet rows; filters: `driverId`, `type`, `status`, `page`, `limit` |
| `GET` | `/cashouts` | List cashout requests; filters: `driverId`, `status`, `page`, `limit` |

### Block / deactivate

- `PATCH /users/{id}` with `{ "isBlocked": true }` blocks the account and revokes all sessions.
- `PATCH /users/{id}` with `{ "isBlocked": false }` unblocks.
- `DELETE /users/{id}` is equivalent to blocking (soft deactivate). Use for drivers and passengers.
- Admins cannot block themselves or other admin accounts via these endpoints.

## Shared rides catalog

Base path: `/api/admin/shared-rides`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/corridor-locations` | List zones; filters: `q`, `isActive`, `page`, `limit` |
| `GET` | `/corridor-locations/{id}` | Zone detail with pickup/dropoff slots and counts |
| `POST` | `/corridor-locations` | Create corridor/zone |
| `PATCH` | `/corridor-locations/{id}` | Update corridor/zone coordinates, radius, active state |
| `DELETE` | `/corridor-locations/{id}` | Soft-delete corridor/zone |
| `GET` | `/sgr-schedule-slots` | List timetable slots; filters: `pickupLocationId`, `dropoffLocationId`, `direction`, `isActive`, `page`, `limit` |
| `GET` | `/sgr-schedule-slots/{id}` | Slot detail with locations and departure/trip-request counts |
| `POST` | `/sgr-schedule-slots` | Create timetable slot with `suggestedPricePerSeat` |
| `PATCH` | `/sgr-schedule-slots/{id}` | Update timetable and price |
| `DELETE` | `/sgr-schedule-slots/{id}` | Soft-delete slot |

`suggestedPricePerSeat` controls the default/future price for departures created from that slot.
Already-created departures keep their own `pricePerSeat`.
