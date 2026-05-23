export function parseDeclinedBy(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function hasDeclined(value: string | null | undefined, driverId: string): boolean {
  return parseDeclinedBy(value).includes(driverId);
}

export function appendDeclinedBy(value: string | null | undefined, driverId: string): string {
  const existing = parseDeclinedBy(value);
  if (!existing.includes(driverId)) existing.push(driverId);
  return JSON.stringify(existing);
}

