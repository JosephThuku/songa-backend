#!/usr/bin/env tsx
/**
 * Send a test OTP-style SMS through the configured provider (Wasiliana when
 * WASILIANA_API_KEY is set, otherwise console fallback).
 *
 * Usage:
 *   npm run sms:test
 *   npm run sms:test -- +254712000001
 */
import "dotenv/config";
import { getSmsProvider, isSmsConfigured, logSmsProviderStatus, _setSmsProvider } from "../src/lib/sms.js";

async function main(): Promise<void> {
  _setSmsProvider(null);
  logSmsProviderStatus();

  const to = process.argv[2]?.trim() || "+254712000001";
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const provider = getSmsProvider();

  console.log(`Provider: ${provider.name}`);
  if (!isSmsConfigured()) {
    console.error(
      "\nWASILIANA_API_KEY is empty — no real SMS will be sent.\n" +
        "Add your Wasiliana API key to .env, then re-run.\n",
    );
  }

  const result = await provider.send({
    to,
    body: `Your Songa code is ${code}. It expires in 5 minutes. Do not share it.`,
    isOtp: true,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
  if (provider.name === "console") {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
