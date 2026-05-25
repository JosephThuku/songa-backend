# Dummy place search (Nairobi + Mombasa)

When **`GOOGLE_PLACES_API_KEY` is unset** in development, `/api/places/*` serves locations from:

`data/dummy-places.json`

Force dummy mode anytime:

```env
USE_DUMMY_PLACES=true
```

Use Google instead:

```env
USE_DUMMY_PLACES=false
GOOGLE_PLACES_API_KEY=your_key
```

---

## Bookable dev routes (seeded drivers)

After `npx prisma db seed`, online drivers are placed near these hubs:

| Region | Pickup (type) | Drop-off (type) | Drivers nearby |
|--------|----------------|-----------------|----------------|
| **Nairobi** | `jkia` | `westlands` | 4 near JKIA, 1 in Westlands |
| **Mombasa** | `moi` | `nyali` | 2 near airport / Nyali |

Autocomplete is **scoped to your region** (GPS origin): in Nairobi you will not see Mombasa beaches unless you type `nyali`, `mombasa`, etc.

---

## Nairobi locations

| Search | Place | placeId |
|--------|--------|---------|
| `jkia` | JKIA Terminal 1A | `dummy_nairobi_jkia_t1a` |
| `westlands` | Westlands | `dummy_nairobi_westlands` |
| `cbd` / `kenyatta` | CBD — Kenyatta Avenue | `dummy_nairobi_cbd` |
| `sgr` | Nairobi SGR Terminus | `dummy_nairobi_sgr` |
| `wilson` | Wilson Airport | `dummy_nairobi_wilson` |
| `karen` | Karen | `dummy_nairobi_karen` |
| `gigiri` | Gigiri | `dummy_nairobi_gigiri` |

## Mombasa locations

| Search | Place | placeId |
|--------|--------|---------|
| `moi` / `airport` | Moi International Airport | `dummy_mombasa_airport` |
| `nyali` | Nyali Beach | `dummy_mombasa_nyali` |
| `old town` | Mombasa Old Town | `dummy_mombasa_old_town` |
| `likoni` | Likoni Ferry | `dummy_mombasa_likoni` |
| `bamburi` | Bamburi Beach | `dummy_mombasa_bamburi` |
| `diani` | Diani Beach | `dummy_mombasa_diani` |

---

## Sample trips to test in the app

Log in as passenger (`+254712000001` / `SongaDev1` after seed).

### Nairobi — airport seat-selection flow

| | Value |
|---|--------|
| **Pickup** | JKIA Terminal 1A (type `jkia`) |
| **Dropoff** | Westlands (type `westlands`) |
| **Seats** | 3 and 4 |

Matches seeded online drivers near JKIA.

### Nairobi — city to SGR

| | Value |
|---|--------|
| **Pickup** | CBD — Kenyatta Avenue (`cbd`) |
| **Dropoff** | Nairobi SGR Terminus (`sgr`) |

### Mombasa — coast

| | Value |
|---|--------|
| **Pickup** | Moi International Airport (`moi`) |
| **Dropoff** | Nyali Beach (`nyali`) |

Or **Old Town** → **Diani Beach**.

---

## API test (curl)

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"+254712000001","password":"SongaDev1","role":"passenger"}' \
  | jq -r .sessionToken)

# Autocomplete
curl -s -X POST http://localhost:4000/api/places/autocomplete \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"input":"jkia","sessionToken":"test-1"}' | jq

# Place details
curl -s "http://localhost:4000/api/places/dummy_nairobi_westlands?sessionToken=test-1" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Restart backend after changing `.env`. You should see:

`Places autocomplete: using data/dummy-places.json`
