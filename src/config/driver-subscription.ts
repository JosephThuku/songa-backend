const DEFAULT_DAILY_SUBSCRIPTION_KES = 150;

const DEFAULT_SUBSCRIPTION_BY_VEHICLE_TYPE: Record<string, number> = {
  Bike: 100,
  Tuktuk: 100,
  Car: 150,
  Van: 150,
  Minibus: 200,
};

function parseSubscriptionByVehicleType(): Record<string, number> | null {
  const raw = process.env.DRIVER_SUBSCRIPTION_KES_BY_VEHICLE_TYPE?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const amount = Number(value);
      if (Number.isFinite(amount) && amount >= 0) out[key] = amount;
    }
    return out;
  } catch {
    return null;
  }
}

/** Daily driver subscription in KES for a vehicle type (Nairobi service day). */
export function driverDailySubscriptionKes(vehicleType?: string | null): number {
  const global = process.env.DRIVER_DAILY_SUBSCRIPTION_KES?.trim();
  if (global) {
    const n = Number.parseInt(global, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  const byType = parseSubscriptionByVehicleType();
  if (vehicleType && byType?.[vehicleType] !== undefined) {
    return byType[vehicleType]!;
  }
  if (vehicleType && DEFAULT_SUBSCRIPTION_BY_VEHICLE_TYPE[vehicleType] !== undefined) {
    return DEFAULT_SUBSCRIPTION_BY_VEHICLE_TYPE[vehicleType]!;
  }
  return DEFAULT_DAILY_SUBSCRIPTION_KES;
}
