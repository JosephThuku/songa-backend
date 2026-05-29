import { createPublicKey, publicEncrypt, constants as cryptoConstants } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { loadMpesaConfig, type MpesaConfig } from "../config/mpesa.js";
import { logger } from "../lib/logger.js";

export function normalizeKenyanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("254") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return `254${local.slice(-9)}`;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export class MpesaService {
  constructor(private readonly config: MpesaConfig = loadMpesaConfig()) {}

  private async oauthToken(consumerKey: string, consumerSecret: string): Promise<string | null> {
    const url = `${this.config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, "M-Pesa OAuth failed");
      return null;
    }
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  }

  async generateAccessToken(): Promise<string | null> {
    return this.oauthToken(this.config.consumerKey, this.config.consumerSecret);
  }

  async generateB2cAccessToken(): Promise<string | null> {
    return this.oauthToken(this.config.b2cConsumerKey, this.config.b2cConsumerSecret);
  }

  private generateSecurityCredential(): string | null {
    const { initiatorPassword, certificatePath } = this.config;
    if (!initiatorPassword) return null;
    if (!existsSync(certificatePath)) {
      logger.error({ certificatePath }, "M-Pesa certificate not found");
      return null;
    }
    const cert = readFileSync(certificatePath, "utf8");
    const publicKey = createPublicKey(cert);
    const encrypted = publicEncrypt(
      { key: publicKey, padding: cryptoConstants.RSA_PKCS1_PADDING },
      Buffer.from(initiatorPassword, "utf8"),
    );
    return encrypted.toString("base64");
  }

  async stkPush(input: {
    amount: number;
    phone: string;
    accountReference: string;
    transactionDesc: string;
  }): Promise<{ status: "success" | "error"; message?: string; data?: Record<string, unknown> }> {
    const token = await this.generateAccessToken();
    if (!token) return { status: "error", message: "Could not generate M-Pesa access token" };

    const ts = timestamp();
    const password = Buffer.from(`${this.config.shortcode}${this.config.passKey}${ts}`).toString("base64");
    const phone = normalizeKenyanPhone(input.phone);

    const payload = {
      BusinessShortCode: this.config.shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: input.amount,
      PartyA: phone,
      PartyB: this.config.shortcode,
      PhoneNumber: phone,
      CallBackURL: this.config.stkCallbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.transactionDesc.slice(0, 13),
    };

    const res = await fetch(`${this.config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      logger.error({ data }, "M-Pesa STK push failed");
      return { status: "error", message: String(data.errorMessage ?? "STK push failed") };
    }
    return { status: "success", data };
  }

  async initiateB2c(input: {
    amount: number;
    phone: string;
    remarks: string;
    occasion?: string;
  }): Promise<{ status: "success" | "error"; message?: string; data?: Record<string, unknown> }> {
    const token = await this.generateB2cAccessToken();
    if (!token) return { status: "error", message: "Could not generate M-Pesa B2C access token" };

    const securityCredential = this.generateSecurityCredential();
    if (!securityCredential) {
      return { status: "error", message: "M-Pesa B2C security credential unavailable" };
    }

    const payload = {
      InitiatorName: this.config.initiatorName,
      SecurityCredential: securityCredential,
      CommandID: "SalaryPayment",
      Amount: input.amount,
      PartyA: this.config.b2cShortcode,
      PartyB: normalizeKenyanPhone(input.phone),
      Remarks: input.remarks.slice(0, 100),
      QueueTimeOutURL: this.config.b2cTimeoutUrl,
      ResultURL: this.config.b2cResultUrl,
      Occassion: (input.occasion ?? "").slice(0, 100),
    };

    const res = await fetch(`${this.config.baseUrl}/mpesa/b2c/v1/paymentrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      logger.error({ data }, "M-Pesa B2C failed");
      return { status: "error", message: String(data.errorMessage ?? "B2C payout failed") };
    }
    return { status: "success", data };
  }
}
