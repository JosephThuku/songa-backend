# Stage 7 — Notifications and Device Tokens

## 1. Goal

Persist in-app notifications and register mobile push tokens. Stage 7 creates notification records for ride offers, accepted rides, arrivals, and completed trips. Actual FCM/APNs delivery is represented by device-token storage and can be wired to providers later.

## 2. Endpoints

- `GET /api/notifications?limit=30`
- `POST /api/devices`

## 3. Triggers

- `ride.offer` to driver: notification type `ride_offer`
- driver accepted: passenger notification type `ride_update`
- driver arrived: passenger notification type `ride_update`
- trip completed: passenger notification type `ride_update`

## 4. Tests

- Device registration upserts by token.
- Inbox returns newest-first notifications.
- Ride offer creates driver notification.
- Accept creates passenger notification.

