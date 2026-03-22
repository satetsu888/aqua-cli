import { describe, it, expect } from "vitest";
import { evaluateAssertions } from "./assertions.js";

describe("evaluateAssertions", () => {
  it("returns empty array when no assertions", () => {
    expect(evaluateAssertions(undefined, {})).toEqual([]);
    expect(evaluateAssertions([], {})).toEqual([]);
  });

  describe("stripe_field", () => {
    const response = {
      id: "sub_123",
      status: "active",
      items: {
        data: [
          { price: { id: "price_abc", unit_amount: 1000 } },
        ],
      },
    };

    it("passes when field equals expected", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "status", expected: "active" }],
        response,
      );
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it("fails when field does not equal expected", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "status", expected: "canceled" }],
        response,
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe("active");
    });

    it("resolves nested paths", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "items.data[0].price.id", expected: "price_abc" }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports contains condition", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "id", expected: "sub", condition: "contains" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports not_equals condition", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "status", expected: "canceled", condition: "not_equals" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports exists condition", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "status", expected: "", condition: "exists" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports not_exists condition", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "nonexistent", expected: "", condition: "not_exists" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports greater_than condition", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "items.data[0].price.unit_amount", expected: "500", condition: "greater_than" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports less_than condition", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_field", path: "items.data[0].price.unit_amount", expected: "2000", condition: "less_than" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });
  });

  describe("stripe_object_exists", () => {
    it("passes when object exists and exists=true", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_object_exists", exists: true }],
        { id: "sub_123" },
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when object is null and exists=true", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_object_exists", exists: true }],
        null,
      );
      expect(results[0].passed).toBe(false);
    });

    it("passes when object is null and exists=false", () => {
      const results = evaluateAssertions(
        [{ type: "stripe_object_exists", exists: false }],
        null,
      );
      expect(results[0].passed).toBe(true);
    });
  });
});
