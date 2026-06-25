import { afterEach, describe, expect, it, vi } from "vitest";
import { payInviteLink } from "../src/lib/booking-pay-invite.js";

describe("payInviteLink", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds web URL matching Expo route when PAY_INVITE_BASE_URL is set", () => {
    vi.stubEnv("PAY_INVITE_BASE_URL", "https://app.songa.africa");
    expect(payInviteLink("jwt-token")).toBe(
      "https://app.songa.africa/shared-rides/pay-invite?token=jwt-token",
    );
  });

  it("strips trailing slash from web base", () => {
    vi.stubEnv("PAY_INVITE_BASE_URL", "https://app.songa.africa/");
    expect(payInviteLink("abc")).toBe(
      "https://app.songa.africa/shared-rides/pay-invite?token=abc",
    );
  });

  it("defaults to www.songa.africa when PAY_INVITE_BASE_URL is unset", () => {
    vi.stubEnv("PAY_INVITE_BASE_URL", "");
    expect(payInviteLink("abc")).toBe(
      "https://www.songa.africa/shared-rides/pay-invite?token=abc",
    );
  });
});
