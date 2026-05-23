# Stage 6 — Driver Wallet Ledger

## 1. Goal

Credit driver wallet when trips complete and expose wallet/cashout endpoints for the driver wallet tab.

## 2. Schema

Add `WalletTransaction` append-only ledger rows:

```prisma
model WalletTransaction {
  id        String @id
  driverId  String
  rideId    String?
  type      String // credit | debit
  label     String
  amount    Int
  currency  String @default("KES")
  status    String @default("posted")
  createdAt DateTime @default(now())
}
```

Trip completion credits `max(0, ride.price - 50)` KES. Cashout creates a pending debit.

## 3. Endpoints

- `GET /api/drivers/me/wallet`
- `POST /api/drivers/me/wallet/cashout`

## 4. Tests

- Completing a ride creates one credit ledger row.
- Wallet endpoint returns balance and transactions.
- Cashout with sufficient balance creates pending debit.
- Cashout above balance returns `409 INSUFFICIENT_FUNDS`.

