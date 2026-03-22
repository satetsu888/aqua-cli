import { describe, it, expect } from "vitest";
import { getJsonPath, extractValues } from "./utils.js";

describe("getJsonPath", () => {
  const obj = {
    status: "active",
    id: "sub_123",
    items: {
      data: [
        { price: { id: "price_abc", unit_amount: 1000 } },
        { price: { id: "price_def", unit_amount: 2000 } },
      ],
    },
    metadata: {},
  };

  it("resolves top-level field", () => {
    expect(getJsonPath(obj, "status")).toBe("active");
  });

  it("resolves top-level field with $ prefix", () => {
    expect(getJsonPath(obj, "$.status")).toBe("active");
  });

  it("resolves nested dot path", () => {
    expect(getJsonPath(obj, "items.data")).toBe(obj.items.data);
  });

  it("resolves array index", () => {
    expect(getJsonPath(obj, "items.data[0].price.id")).toBe("price_abc");
    expect(getJsonPath(obj, "items.data[1].price.unit_amount")).toBe(2000);
  });

  it("resolves with $ prefix and array index", () => {
    expect(getJsonPath(obj, "$.items.data[0].price.id")).toBe("price_abc");
  });

  it("returns undefined for missing path", () => {
    expect(getJsonPath(obj, "nonexistent")).toBeUndefined();
    expect(getJsonPath(obj, "items.data[5].price")).toBeUndefined();
  });

  it("returns undefined for null input", () => {
    expect(getJsonPath(null, "status")).toBeUndefined();
    expect(getJsonPath(undefined, "status")).toBeUndefined();
  });
});

describe("extractValues", () => {
  const response = {
    id: "sub_123",
    status: "active",
    items: { data: [{ price: { id: "price_abc" } }] },
  };

  it("extracts values by json path", () => {
    const result = extractValues(
      { sub_id: "$.id", sub_status: "$.status" },
      response,
    );
    expect(result).toEqual({
      sub_id: "sub_123",
      sub_status: "active",
    });
  });

  it("extracts nested values", () => {
    const result = extractValues(
      { price_id: "$.items.data[0].price.id" },
      response,
    );
    expect(result).toEqual({ price_id: "price_abc" });
  });

  it("skips undefined values", () => {
    const result = extractValues(
      { missing: "$.nonexistent" },
      response,
    );
    expect(result).toEqual({});
  });

  it("returns empty object when extract is undefined", () => {
    expect(extractValues(undefined, response)).toEqual({});
  });

  it("converts non-string values to string", () => {
    const result = extractValues({ count: "$.items.data.length" }, { items: { data: { length: 1 } } });
    expect(result.count).toBe("1");
  });
});
