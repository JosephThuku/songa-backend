import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.js";

describe("API docs (Swagger UI)", () => {
  it("serves HTML at /api/docs without redirecting to a trailing slash", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/docs");

    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).toContain('base href="/api/docs/"');
    expect(res.text).toContain("swagger-ui");
  });

  it("serves swagger-ui.css with a stylesheet MIME type", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/docs/swagger-ui.css");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/css/);
    expect(res.text.length).toBeGreaterThan(1000);
  });

  it("serves swagger-ui-bundle.js as JavaScript", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/docs/swagger-ui-bundle.js");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
  });
});
