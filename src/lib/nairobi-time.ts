/** Wall-clock parts in Africa/Nairobi (EAT, UTC+3, no DST). */

export const NAIROBI_TIMEZONE = "Africa/Nairobi" as const;
/** Fixed offset for API serialization (Kenya does not observe DST). */
export const NAIROBI_ISO_OFFSET = "+03:00" as const;

export type NairobiParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function getNairobiParts(at: Date = new Date()): NairobiParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function parseTimeHm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map((s) => Number.parseInt(s, 10));
  return { hour: h ?? 0, minute: m ?? 0 };
}

export function minutesFromHm(value: string): number {
  const { hour, minute } = parseTimeHm(value);
  return hour * 60 + minute;
}

/** UTC Date for a calendar day + HH:mm in Nairobi. */
export function nairobiLocalToUtc(
  parts: NairobiParts,
  timeHm: string,
  dayOffset = 0,
): Date {
  const { hour, minute } = parseTimeHm(timeHm);
  const utcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + dayOffset,
    hour - 3,
    minute,
    0,
    0,
  );
  return new Date(utcMs);
}

export function formatHm(value: string): string {
  const { hour, minute } = parseTimeHm(value);
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO 8601 in East Africa Time, e.g. `2026-06-02T06:00:00+03:00`. */
export function toNairobiIso(at: Date): string {
  const p = getNairobiParts(at);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00${NAIROBI_ISO_OFFSET}`;
}

/** Human label for SMS / push copy, e.g. `Sat, 6 Jun, 12:00`. */
export function formatNairobiDepartureLabel(at: Date | string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: NAIROBI_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
