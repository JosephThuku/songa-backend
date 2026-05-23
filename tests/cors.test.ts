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
});
