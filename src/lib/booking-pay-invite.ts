import jwt, { type JwtPayload } from "jsonwebtoken";
import { loadEnv } from "../config/env.js";

const ALGORITHM = "HS256" as const;

export type BookingPayInvitePayload = JwtPayload & {
  typ: "booking_pay";
  bid: string;
  sub: string;
};

function secret(): string {
  return loadEnv().SESSION_JWT_SECRET;
}

export function signBookingPayInvite(input: {
  bookingId: string;
  passengerId: string;
  expiresInSeconds: number;
}): string {
  return jwt.sign(
    { typ: "booking_pay", bid: input.bookingId, sub: input.passengerId },
    secret(),
    { algorithm: ALGORITHM, expiresIn: input.expiresInSeconds },
  );
}

export function verifyBookingPayInvite(token: string): BookingPayInvitePayload {
  const decoded = jwt.verify(token, secret(), { algorithms: [ALGORITHM] });
  if (typeof decoded === "string") {
    throw new Error("Invalid pay invite token");
  }
  const payload = decoded as BookingPayInvitePayload;
  if (payload.typ !== "booking_pay" || !payload.bid || !payload.sub) {
    throw new Error("Invalid pay invite token");
  }
  return payload;
}

const PAY_INVITE_PATH = "/shared-rides/pay-invite";
/** Public web app — guest pay links open in the browser (no app install). */
const DEFAULT_PAY_INVITE_BASE_URL = "https://www.songa.africa";

export function payInviteLink(token: string): string {
  const webBase = process.env.PAY_INVITE_BASE_URL?.trim() || DEFAULT_PAY_INVITE_BASE_URL;
  const query = `token=${encodeURIComponent(token)}`;
  return `${webBase.replace(/\/$/, "")}${PAY_INVITE_PATH}?${query}`;
}
