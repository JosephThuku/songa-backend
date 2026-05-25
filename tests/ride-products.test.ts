import { describe, expect, it } from "vitest";
import { getRideProduct, RIDE_PRODUCTS, type RideProduct } from "../src/lib/ride-products.js";

describe("getRideProduct", () => {
  it("returns a product for 'car'", () => {
    const product = getRideProduct("car");
    expect(product).toBeDefined();
    expect(product!.optionId).toBe("car");
    expect(product!.vehicleType).toBe("Car");
    expect(typeof product!.label).toBe("string");
    expect(product!.label.length).toBeGreaterThan(0);
    expect(product!.capacity).toBeGreaterThanOrEqual(1);
  });

  it("returns a product for 'van'", () => {
    const product = getRideProduct("van");
    expect(product).toBeDefined();
    expect(product!.optionId).toBe("van");
    expect(product!.vehicleType).toBe("Van");
    expect(product!.capacity).toBeGreaterThan(4);
  });

  it("returns a product for 'minibus'", () => {
    const product = getRideProduct("minibus");
    expect(product).toBeDefined();
    expect(product!.optionId).toBe("minibus");
    expect(product!.capacity).toBeGreaterThan(7);
  });

  it("returns undefined for an unknown optionId", () => {
    expect(getRideProduct("unknown")).toBeUndefined();
    expect(getRideProduct("")).toBeUndefined();
    expect(getRideProduct("helicopter")).toBeUndefined();
  });

  it("returns undefined for 'Car' (wrong case)", () => {
    expect(getRideProduct("Car")).toBeUndefined();
  });
});

describe("RIDE_PRODUCTS catalogue", () => {
  it("has at least one product", () => {
    expect(RIDE_PRODUCTS.length).toBeGreaterThanOrEqual(1);
  });

  it("every product has all required fields", () => {
    for (const product of RIDE_PRODUCTS) {
      expect(typeof product.optionId).toBe("string");
      expect(product.optionId.length).toBeGreaterThan(0);

      expect(typeof product.vehicleType).toBe("string");
      expect(product.vehicleType.length).toBeGreaterThan(0);

      expect(typeof product.label).toBe("string");
      expect(product.label.length).toBeGreaterThan(0);

      expect(typeof product.capacity).toBe("number");
      expect(product.capacity).toBeGreaterThanOrEqual(1);

      expect(typeof product.priceMultiplier).toBe("number");
      expect(product.priceMultiplier).toBeGreaterThan(0);
    }
  });

  it("all optionIds are unique", () => {
    const ids = RIDE_PRODUCTS.map((p: RideProduct) => p.optionId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("all vehicleTypes are unique", () => {
    const types = RIDE_PRODUCTS.map((p: RideProduct) => p.vehicleType);
    const uniqueTypes = new Set(types);
    expect(uniqueTypes.size).toBe(types.length);
  });

  it("capacities are in ascending order", () => {
    const capacities = RIDE_PRODUCTS.map((p: RideProduct) => p.capacity);
    for (let i = 1; i < capacities.length; i++) {
      expect(capacities[i]!).toBeGreaterThanOrEqual(capacities[i - 1]!);
    }
  });

  it("getRideProduct returns same reference as RIDE_PRODUCTS entry", () => {
    for (const product of RIDE_PRODUCTS) {
      const found = getRideProduct(product.optionId);
      expect(found).toBe(product);
    }
  });
});
