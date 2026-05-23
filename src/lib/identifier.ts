import { normalizePhone } from "./phone.js";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/** Login identifier: E.164 phone or normalized email. */
export function normalizeLoginIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (isEmailIdentifier(trimmed)) {
    return normalizeEmail(trimmed);
  }
  return normalizePhone(trimmed);
}
