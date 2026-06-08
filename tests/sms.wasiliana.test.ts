import { afterEach, describe, expect, it, vi } from "vitest";
import { sendViaWasiliana, toWasilianaRecipient } from "../src/lib/sms.wasiliana.js";
import { ConsoleSmsProvider, WasilianaProvider, _setSmsProvider, getSmsProvider, isSmsConfigured } from "../src/lib/sms.js";

describe("toWasilianaRecipient", () => {
  it("strips leading + for national format", () => {
    expect(toWasilianaRecipient("+254712000001")).toBe("254712000001");
    expect(toWasilianaRecipient("254712000001")).toBe("254712000001");
  });
});

describe("sendViaWasiliana", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs OTP payload with apiKey header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: "success", data: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendViaWasiliana(
      { apiKey: "test-key", senderId: "SONGA", baseUrl: "https://api.wasiliana.com" },
      { to: "+254712000001", body: "Your Songa code is 123456.", isOtp: true },
    );

    expect(result.id).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.wasiliana.com/api/v1/send/sms");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).apiKey).toBe("test-key");
    expect(JSON.parse(String(init.body))).toEqual({
      recipients: ["254712000001"],
      from: "SONGA",
      message: "Your Songa code is 123456.",
      is_otp: true,
    });
  });

  it("throws when Wasiliana returns failed status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: "failed", data: "Wrong sender id sent" }),
      }),
    );

    await expect(
      sendViaWasiliana(
        { apiKey: "test-key", senderId: "SONGA", baseUrl: "https://api.wasiliana.com" },
        { to: "+254712000001", body: "hi", isOtp: true },
      ),
    ).rejects.toThrow(/Wrong sender id sent/);
  });
});

describe("getSmsProvider", () => {
  afterEach(() => {
    _setSmsProvider(null);
    delete process.env.WASILIANA_API_KEY;
    delete process.env.WASILIANA_SENDER_ID;
  });

  it("uses console fallback when API key is empty", () => {
    process.env.WASILIANA_SENDER_ID = "SONGA";
    process.env.WASILIANA_API_KEY = "";
    expect(isSmsConfigured()).toBe(false);
    expect(getSmsProvider().name).toBe("console");
  });

  it("uses Wasiliana when API key is set", () => {
    process.env.WASILIANA_API_KEY = "secret";
    process.env.WASILIANA_SENDER_ID = "SONGA";
    expect(isSmsConfigured()).toBe(true);
    expect(getSmsProvider().name).toBe("wasiliana");
  });
});

describe("WasilianaProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:false on HTTP error without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "App does not match your api key", code: 401 }),
      }),
    );

    const provider = new WasilianaProvider({
      apiKey: "bad",
      senderId: "SONGA",
      baseUrl: "https://api.wasiliana.com",
    });
    const result = await provider.send({ to: "+254712000001", body: "code", isOtp: true });
    expect(result.ok).toBe(false);
    expect(result.provider).toBe("wasiliana");
    expect(result.error).toMatch(/401/);
  });
});
