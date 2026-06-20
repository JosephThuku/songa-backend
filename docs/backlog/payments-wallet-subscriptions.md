# Payments, wallet, and subscriptions backlog

This backlog is centered on making STK-style passenger payments and driver withdrawals production-ready for the Kenyan Songa model.

Product principle:

- Normal on-demand rides are pay-on-drop for now. The passenger pays the driver directly at drop-off.
- Shared SGR/Airport bookings are prepaid after booking. Passenger reserves seats, creates booking, then pays before seats become confirmed.
- Songa monetization should come from driver subscriptions, not passenger commissions.
- Manual Paybill/Till is disabled for now. Only M-Pesa STK push should be available for in-app payments until C2B reconciliation is implemented.

## Issue 1: Stop pay-on-drop rides from creating withdrawable wallet balance

GitHub: https://github.com/JosephThuku/songa-backend/issues/11

Priority: Critical

Current behavior:

- Completing any on-demand ride creates a posted `WalletTransaction` credit for the driver.
- For cash/pay-on-drop rides, Songa has not collected money, so that credit becomes a double-payment risk: the driver can collect cash from the passenger and also cash out from Songa.

Expected behavior:

- Pay-on-drop rides should create driver earning history, not withdrawable wallet balance.
- Withdrawable wallet balance should only include money Songa has actually collected and owes the driver, such as paid shared SGR bookings or future in-app prepaid rides.
- Driver daily subscription fees can be calculated from earning/activity history, but should not require fake wallet credits for cash rides.

Acceptance criteria:

- Completing a non-prepaid on-demand ride does not increase withdrawable wallet balance.
- Driver can still see ride earnings/history for completed cash rides.
- Cash ride earnings are available for subscription decisions/reporting.
- Existing wallet cashout only uses collected funds.
- Tests cover cash ride completion, prepaid/shared payment completion, wallet balance, and cashout eligibility.

Implementation notes:

- Prefer separating "earnings history" from "wallet ledger".
- Add an `DriverEarning`/`EarningEvent` style table for all completed driver income, including cash rides.
- Keep `WalletTransaction` for collected funds, withdrawals, refunds, and subscription debits/credits.
- If a full new table is too large for the first fix, at minimum gate wallet credits on `ride.prepaid === true` or known in-app collection.

## Issue 2: Fix wallet balance calculation; do not use only latest 30 transactions

GitHub: https://github.com/JosephThuku/songa-backend/issues/12

Priority: Critical / ASAP

Current behavior:

- `getDriverWallet()` fetches only the latest 30 `WalletTransaction` rows and calculates balance from that subset.
- Any driver with more than 30 transactions can see an incorrect balance and may be allowed or blocked incorrectly on cashout.

Expected behavior:

- Wallet balance must be calculated from the full ledger or from a persisted balance maintained transactionally.
- The transaction list can remain paginated, but balance cannot be paginated.

Acceptance criteria:

- Wallet response returns correct balance with more than 30 transactions.
- `pendingPayout` is calculated across all pending payout debits.
- Transaction history remains limited/paginated separately from balance.
- Tests cover at least 31+ transactions and mixed posted/pending/failed statuses.

Implementation notes:

- Short-term: use Prisma aggregate/sum queries over all relevant wallet rows.
- Medium-term: add a `DriverWalletAccount` table with `availableBalance`, `pendingPayout`, and transactional updates.

## Issue 3: Make driver cashout atomic and race-safe

GitHub: https://github.com/JosephThuku/songa-backend/issues/13

Priority: Critical / ASAP

Current behavior:

- Cashout checks wallet balance, then creates a pending debit.
- Two simultaneous cashouts can both pass the balance check and overdraw the wallet.

Expected behavior:

- Cashout reserve/debit must happen atomically.
- Concurrent cashout attempts cannot overdraw a driver wallet.
- M-Pesa B2C initiation failure must reliably refund/release the reserved amount.

Acceptance criteria:

- Cashout reserve runs in a transaction with a driver/account-level lock or atomic balance update.
- Concurrent cashout test proves only one request succeeds when balance allows one payout.
- Pending payout is included in available balance rules.
- B2C success marks debit posted after callback.
- B2C failure/timeout path can fail/refund idempotently.

Implementation notes:

- Best paired with a `DriverWalletAccount` table and conditional update: `availableBalance >= amount`.
- Add an idempotency key for cashout requests to prevent duplicate taps from creating duplicate withdrawals.

## Issue 4: Replace dummy Flutterwave checkout or disable Flutterwave in production

GitHub: https://github.com/JosephThuku/songa-backend/issues/14

Priority: High

Current behavior:

- Non-M-Pesa booking payments return a dummy local checkout URL.
- There is no real Flutterwave initialization, webhook, signature verification, or payment completion flow.

Expected behavior:

- Either implement real Flutterwave checkout and webhook handling, or hide/disable Flutterwave outside development.
- For this phase, passenger booking payment should prefer M-Pesa STK push.

Acceptance criteria:

- Production cannot create dummy `payments.songa.local` checkout sessions.
- If Flutterwave remains enabled, it creates real checkout sessions and verifies provider webhooks before marking bookings paid.
- Tests cover disabled provider behavior or real provider webhook behavior.

Implementation notes:

- Add provider availability config.
- Return `PAYMENT_PROVIDER_DISABLED` when Flutterwave is not configured/enabled.
- Keep `ALLOW_DEV_PAYMENT_CONFIRM=true` dev simulation clearly scoped to non-production.

## Issue 5: Disable manual M-Pesa Paybill/Till booking flow for now

GitHub: https://github.com/JosephThuku/songa-backend/issues/15

Priority: High

Current behavior:

- API can return manual Paybill/Till instructions if display config is present.
- There is no C2B confirmation/reconciliation path to mark those payments paid.

Expected behavior:

- Only STK push should be accepted for M-Pesa booking payments for now.
- Manual Paybill/Till should return a clear disabled error until C2B confirmation exists.

Acceptance criteria:

- `mpesaChannel: "paybill"` and `mpesaChannel: "till"` fail with a clear `MPESA_MANUAL_DISABLED` or equivalent error.
- Mobile/API docs show STK as the only supported M-Pesa payment channel.
- Tests cover rejected Paybill/Till and successful STK initiation.

Implementation notes:

- Keep display config for future use, but do not expose manual payment instructions.
- Later issue can add C2B validation/confirmation endpoints and reconciliation tooling.

## Issue 6: Harden M-Pesa STK payment completion

GitHub: https://github.com/JosephThuku/songa-backend/issues/16

Priority: High

Current behavior:

- STK initiation and callback exist.
- Callback marks booking paid using `CheckoutRequestID`, but does not verify callback amount against booking total.

Expected behavior:

- Only verified, amount-matching M-Pesa callbacks should mark bookings paid.
- Duplicate callbacks should be idempotent.

Acceptance criteria:

- Callback extracts and stores receipt, amount, phone, transaction date, and raw callback.
- Callback verifies paid amount equals booking total.
- Amount mismatch fails/flags payment and does not mark booking paid.
- Duplicate success callback does not duplicate wallet credits.
- Tests cover success, failure, duplicate, and amount mismatch.

Implementation notes:

- Add fields or normalized provider metadata if needed.
- Consider callback source validation where Safaricom infrastructure allows it, but amount/idempotency checks are the minimum.

## Issue 7: Implement driver subscription billing

GitHub: https://github.com/JosephThuku/songa-backend/issues/18

Priority: High

Current behavior:

- Subscription billing is documented as backlog.
- There is no subscription plan, daily fee debit, grace period, or access gating.

Recommended model:

- Use daily flat subscriptions by vehicle type first. Example: around 150 KES/day for common vehicle classes, configurable per vehicle type.
- Charge once per driver service day when the driver earns or goes online, depending on product decision.
- Do not charge passengers a Songa fee for shared SGR checkout.

Proposed data model:

- `DriverSubscriptionPlan`: vehicle type, daily amount, currency, active flag.
- `DriverSubscriptionAccount`: driver, plan, status, current period/date, balance due, grace metadata.
- `DriverSubscriptionCharge`: driver, service date, amount, status, source, idempotency key.
- Keep subscription debits in wallet ledger when paid from collected funds; keep unpaid dues separately if wallet has no available balance.

Open product decisions:

- Trigger: charge when driver first goes online, completes first ride, receives first prepaid booking, or at daily cron?
- Empty wallet: allow negative subscription balance, block going online, or give grace?
- Cash rides: should the app ask driver to pay subscription via STK if wallet has no collected funds?
- Vehicle-specific amounts: exact KES/day per Bike, Tuktuk, Car, Van, Minibus.

Acceptance criteria:

- Admin/config can define daily subscription amounts by vehicle type.
- Driver is charged at most once per Nairobi calendar day.
- Subscription charge can be paid from wallet balance or via M-Pesa STK.
- Driver online/shared departure publishing can be gated by subscription status after any configured grace.
- Tests cover same-day idempotency, next-day charge, insufficient wallet behavior, and vehicle-type pricing.

## Issue 8: Clarify shared SGR cancellations/refunds and departure completion settlement

GitHub: https://github.com/JosephThuku/songa-backend/issues/17

Priority: Medium

Current behavior:

- Shared SGR booking, seat payment, seat confirmation, and driver wallet credit are implemented.
- If a shared departure is cancelled, bookings are marked cancelled and seats released, but refund/reversal behavior is not defined here.

Expected behavior:

- Paid shared booking cancellation should have explicit refund or wallet reversal rules.
- Driver wallet credits should not remain withdrawable if Songa must refund the passenger.

Acceptance criteria:

- Cancelling a paid shared departure creates refund/reversal records or blocks cancellation after paid seats unless admin flow handles it.
- Driver wallet credit is reversed or reserved appropriately if passenger refund is due.
- Tests cover cancelling with pending and paid bookings.

## GitHub issue creation checklist

Create these as individual GitHub issues, using the section titles above as issue titles:

- Stop pay-on-drop rides from creating withdrawable wallet balance
- Fix wallet balance calculation; do not use only latest 30 transactions
- Make driver cashout atomic and race-safe
- Replace dummy Flutterwave checkout or disable Flutterwave in production
- Disable manual M-Pesa Paybill/Till booking flow for now
- Harden M-Pesa STK payment completion
- Implement driver subscription billing
- Clarify shared SGR cancellations/refunds and departure completion settlement
