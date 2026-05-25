import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.js";

describe("CORS", () => {
  it("allows preflight from Expo web (localhost:8081) in test/dev mode", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .options("/api/auth/register")
      .set("Origin", "http://localhost:8081")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,authorization");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:8081");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows preflight from Expo tunnel web (*.exp.direct) when using an allowlist in dev", async () => {
    const prev = { ...process.env };
    process.env.NODE_ENV = "development";
    process.env.CORS_ALLOW_ALL = "false";
    process.env.CORS_ORIGINS = "http://localhost:4000";
    const { _resetEnvCache } = await import("../src/config/env.js");
    _resetEnvCache();

    const app = buildTestApp();
    const origin = "https://0d-v-pq-gitungati-8082.exp.direct";
    const res = await request(app)
      .options("/api/auth/login")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,authorization");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);

    process.env.NODE_ENV = prev.NODE_ENV;
    process.env.CORS_ALLOW_ALL = prev.CORS_ALLOW_ALL;
    process.env.CORS_ORIGINS = prev.CORS_ORIGINS;
    _resetEnvCache();
  });
});
