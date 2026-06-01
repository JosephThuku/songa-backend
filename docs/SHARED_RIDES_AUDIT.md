# Shared rides / SGR — audit (control doc)

Last updated after reverting the large shared-rides port. Use this with [songa/](../songa/) (Laravel reference) for product intent—not as shipped code in `songa-backend` / `songa-mobile-app`.

## Revert note

A full port (Prisma `Departure`, trip-request board, mobile `ride-share` API wiring) was **reverted** so the team can agree on design before merging. `songa-backend` and `songa-mobile-app` are back to **on-demand dispatch + terminal seat rules** only.

---

## What exists today (do not break without coordination)

### songa-backend — on-demand (primary)

| Piece | Role |
|-------|------|
| `POST /api/rides/search` | Haversine fare by pickup/dropoff |
| `POST /api/rides/request` | One `Ride` per passenger; dispatch `ride.offer` |
| `getBookingMode()` in `src/lib/ride-booking-mode.ts` | If label matches airport/SGR/terminal → `seat_selection`, else `pay_on_arrival` |
| `Booking` + M-Pesa | Prepaid terminal trips (JKIA-style), not coast zone pricing |
| `Ride.seats` | Comma-separated seat numbers on **dispatch** rides |
| `tripId` / `listingId` on request | Optional fields; **not** wired to a shared-departure catalog |
| `data/dummy-places.json` | Nyali/Bamburi **beach** autocomplete only; no Mtwapa/SGR Miritini, no fixed KES |

**There is no** `GET` departures list, corridor zones, SGR schedule slots, or trip-request pool in Node today.

### songa-mobile-app — on-demand (primary)

| Piece | Role |
|-------|------|
| Home → `request-ride` → `RideFlowOverlay` | Bolt-style search, request, track |
| `lib/trip-booking-rules.ts` | Same terminal/SGR **label** detection as backend |
| `app/ride-share.tsx` | **Mock UI** (static routes, KES 350); not calling backend |
| `app/driver-requests.tsx` | **Stub** (“listings not available”); not the Laravel board |
| `listingId` on types | Never set in UI |
| `components/songa/manual-ride-request-form.tsx` | Local AsyncStorage only; not mounted in main flow |
| `app/checkout.tsx` | Booking pay path exists; rarely linked from navigation |

### songa/ (reference only — Laravel)

Scheduled **shared** marketplace: `Trip`, `TripRequest`, `SgrScheduleSlot`, `Location`, seat grid, driver **join**, search sorted by occupancy. Mtwapa ↔ SGR Miritini seeded; admin can manage slots. **Not** deployed as your production API.

---

## What “shared rides” means (target product)

Two products in one app:

1. **On-demand (keep)** — Uber-style: passenger requests point-to-point, nearest driver accepts. Unchanged moat for generic trips.

2. **Shared SGR / coast (introduce carefully)** — Matatu-style **scheduled van** to/from **SGR Miritini**:
   - Fixed **corridor price** by **neighborhood zone** (not GPS distance).
   - Passengers **browse departures** (fill seats, sort by occupancy + time) or **post intent** if none; drivers **publish** or **join** intent.
   - **Seat map** per departure; **prepay** for shared (product default).
   - **Fallback**: explicit “private ride” → existing `POST /api/rides/*`.

Naming: reference **Trip** = our **Departure** (not `Ride`).

---

## Proposed design (next implementation — after sign-off)

### Corridor locations (admin + mobile)

| Concern | Approach |
|---------|----------|
| **Catalog** | Admin CRUD for `CorridorLocation` (name, optional polygon/center+radius, active). Not a hardcoded `constants.ts` list. |
| **Detect zone** | Mobile GPS → reverse geocode or point-in-polygon → zone (Mtwapa, Nyali, Bamburi, Tudor, CBD, …). |
| **Pricing** | `SgrScheduleSlot` or `ZoneFare`: zone + direction (to-SGR / from-SGR) + train slot → **KES/seat**. |
| **SGR endpoint** | Pickup/dropoff at **SGR Miritini** stays a fixed stop (train timing drives van slot). |
| **Neighborhood pickup** | After zone + slot, capture **specific pickup point** (pin, landmark, or short address) for the driver—this was weak in the old web app. |

### What to preserve from current app

- All `/api/rides/*` dispatch, driver online, sockets, wallet.
- Terminal `seat_selection` for **JKIA/Nairobi SGR labels** on on-demand rides.
- Do not overload `Ride` for shared departures—parallel models.

### Phased introduction (minimal blast radius)

| Phase | Backend | Mobile | Touches other dev? |
|-------|---------|--------|-------------------|
| 0 | This audit + product doc | — | No code |
| 1 | Admin locations + zones API; seed; `GET departures/search` | Replace mock `ride-share` read-only | New routes only |
| 2 | Trip-request pool + driver join | `driver-requests` wired | Driver tab |
| 3 | Seat reserve + departure booking pay | `departure/[id]` + checkout link | Booking service extension |
| 4 | “Private ride” CTA | Link to `request-ride` | One button |
| 5 | Driver publish departure | Driver screen | Optional |

Each phase = small PR; no monolith.

---

## Backlog (not in scope until designed)

- **Luggage**: Ask passengers baggage amount; capacity rules (seats vs boot space). Needs market input (matatu norms, surcharges, or “large luggage = private ride”). Track here until a simple rule exists.
- Open intents visible in search feed vs separate “pending” tab.
- Multi-driver bid vs first-join-wins.
- Car slots on SGR corridor vs van-only.

---

## Coordination

- **Other dev**: Owns core dispatch, auth, payments. Shared module = `/api/shared-rides/*` and Prisma models—avoid editing `ride.service.ts` except explicit fallback links.
- **Phase 1 progress**: [SHARED_RIDES_PHASE1.md](./SHARED_RIDES_PHASE1.md) (checklist).
