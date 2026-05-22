// NEW — phone normalization to E.164 via libphonenumber-js.

import { parsePhoneNumberFromString } from "libphonenumber-js";
import { AppError } from "./errors.js";

/**
 * Normalize a user-supplied phone string to E.164.
 * Defaults to Kenya (`KE`) when no country code prefix is supplied.
 * Throws AppError("INVALID_PHONE", 400, ...) on failure or for a non-mobile number.
 */
export function normalizePhone(input: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new AppError("INVALID_PHONE", 400, "Phone number is required.");
  }
  const parsed = parsePhoneNumberFromString(input.trim(), "KE");
  if (!parsed || !parsed.isValid()) {
    throw new AppError("INVALID_PHONE", 400, "Phone number is not a valid Kenyan mobile.");
  }
  // Only accept mobile-class numbers when libphonenumber identifies a type.
  // Some Kenyan numbers come back with `MOBILE` or `FIXED_LINE_OR_MOBILE` — both acceptable.
  const type = parsed.getType();
  if (type && type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") {
    throw new AppError("INVALID_PHONE", 400, "Phone number is not a mobile line.");
  }
  return parsed.number; // E.164 form, e.g. "+254712345678"
}
