// Safaricom Daraja (M-Pesa) — optional; when unset, dev auto-confirm can still mark bookings paid.

export type MpesaConfig = {
  environment: "sandbox" | "production";
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passKey: string;
  b2cConsumerKey: string;
  b2cConsumerSecret: string;
  b2cShortcode: string;
  initiatorName: string;
  initiatorPassword: string;
  certificatePath: string;
  stkCallbackUrl: string;
  b2cResultUrl: string;
  b2cTimeoutUrl: string;
  c2bValidationUrl: string;
  c2bConfirmationUrl: string;
  publicApiUrl: string;
};

function envFlag(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export function isMpesaConfigured(): boolean {
  return Boolean(
    envFlag("MPESA_CONSUMER_KEY") &&
      envFlag("MPESA_CONSUMER_SECRET") &&
      envFlag("MPESA_SHORTCODE") &&
      envFlag("MPESA_PASS_KEY"),
  );
}

export function isMpesaB2cConfigured(): boolean {
  return (
    isMpesaConfigured() &&
    Boolean(envFlag("MPESA_INITIATOR_NAME") && envFlag("MPESA_INITIATOR_PASSWORD"))
  );
}

export function loadMpesaConfig(): MpesaConfig {
  const environment =
    envFlag("MPESA_ENVIRONMENT", "sandbox").toLowerCase() === "production"
      ? "production"
      : "sandbox";
  const baseUrl =
    environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  const publicApiUrl = envFlag("PUBLIC_API_URL", envFlag("APP_URL", "http://localhost:4000")).replace(
    /\/$/,
    "",
  );

  const b2cKey = envFlag("MPESA_B2C_CONSUMER_KEY");
  const b2cSecret = envFlag("MPESA_B2C_CONSUMER_SECRET");

  return {
    environment,
    baseUrl,
    consumerKey: envFlag("MPESA_CONSUMER_KEY"),
    consumerSecret: envFlag("MPESA_CONSUMER_SECRET"),
    shortcode: envFlag("MPESA_SHORTCODE"),
    passKey: envFlag("MPESA_PASS_KEY"),
    b2cConsumerKey: b2cKey || envFlag("MPESA_CONSUMER_KEY"),
    b2cConsumerSecret: b2cSecret || envFlag("MPESA_CONSUMER_SECRET"),
    b2cShortcode: envFlag("MPESA_B2C_SHORTCODE") || envFlag("MPESA_SHORTCODE"),
    initiatorName: envFlag("MPESA_INITIATOR_NAME"),
    initiatorPassword: envFlag("MPESA_INITIATOR_PASSWORD"),
    certificatePath: envFlag("MPESA_CERTIFICATE_PATH", "certs/mpesa.cer"),
    stkCallbackUrl: envFlag("MPESA_STK_CALLBACK_URL", `${publicApiUrl}/api/mpesa/stk-callback`),
    b2cResultUrl: envFlag("MPESA_B2C_RESULT_URL", `${publicApiUrl}/api/mpesa/b2c-callback`),
    b2cTimeoutUrl: envFlag("MPESA_B2C_TIMEOUT_URL", `${publicApiUrl}/api/mpesa/b2c-timeout`),
    c2bValidationUrl: envFlag(
      "MPESA_C2B_VALIDATION_URL",
      `${publicApiUrl}/api/mpesa/c2b-validation`,
    ),
    c2bConfirmationUrl: envFlag(
      "MPESA_C2B_CONFIRMATION_URL",
      `${publicApiUrl}/api/mpesa/c2b-confirmation`,
    ),
    publicApiUrl,
  };
}
