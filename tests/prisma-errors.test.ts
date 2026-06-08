import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { mapPrismaError } from "../src/lib/prisma-errors.js";

describe("mapPrismaError", () => {
  it("returns null for non-Prisma errors", () => {
    expect(mapPrismaError(new Error("nope"))).toBeNull();
  });

  it("maps P2002 to CONFLICT", () => {
    const error = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
    });
    expect(mapPrismaError(error)?.code).toBe("CONFLICT");
  });

  it("maps P2003 to REFERENCE_NOT_FOUND with field label", () => {
    const error = new Prisma.PrismaClientKnownRequestError("FK constraint failed", {
      code: "P2003",
      clientVersion: "test",
      meta: { field_name: "bookingId" },
    });
    const mapped = mapPrismaError(error);
    expect(mapped?.code).toBe("REFERENCE_NOT_FOUND");
    expect(mapped?.status).toBe(409);
    expect(mapped?.message).toContain("booking");
  });

  it("maps P2025 to NOT_FOUND", () => {
    const error = new Prisma.PrismaClientKnownRequestError("not found", {
      code: "P2025",
      clientVersion: "test",
    });
    expect(mapPrismaError(error)?.code).toBe("NOT_FOUND");
  });
});
