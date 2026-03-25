import { describe, it, expect } from "vitest";
import { evaluateAssertions } from "./assertions.js";

describe("evaluateAssertions", () => {
  it("returns empty array when no assertions", () => {
    expect(evaluateAssertions(undefined, {})).toEqual([]);
    expect(evaluateAssertions([], {})).toEqual([]);
  });

  describe("supabase_field", () => {
    const response = {
      id: "row_123",
      status: "active",
      metadata: { plan_tier: "pro", count: 42 },
      items: [
        { name: "item_1", price: 1000 },
      ],
    };

    it("passes when field equals expected", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "status", expected: "active" }],
        response,
      );
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it("fails when field does not equal expected", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "status", expected: "inactive" }],
        response,
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe("active");
    });

    it("resolves nested paths", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "metadata.plan_tier", expected: "pro" }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("resolves array index paths", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "items[0].name", expected: "item_1" }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports contains condition", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "id", expected: "row", condition: "contains" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports not_equals condition", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "status", expected: "inactive", condition: "not_equals" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports exists condition", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "status", expected: "", condition: "exists" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports not_exists condition", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "nonexistent", expected: "", condition: "not_exists" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports greater_than condition", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "metadata.count", expected: "10", condition: "greater_than" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports less_than condition", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_field", path: "metadata.count", expected: "100", condition: "less_than" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });
  });

  describe("supabase_row_exists", () => {
    it("passes when row exists and exists=true", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_exists", exists: true }],
        { id: "row_123" },
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when row is null and exists=true", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_exists", exists: true }],
        null,
      );
      expect(results[0].passed).toBe(false);
    });

    it("passes when row is null and exists=false", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_exists", exists: false }],
        null,
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when row exists and exists=false", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_exists", exists: false }],
        { id: "row_123" },
      );
      expect(results[0].passed).toBe(false);
    });
  });

  describe("supabase_row_count", () => {
    const rows = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ];

    it("passes when count equals expected", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_count", expected: 3 }],
        rows,
      );
      expect(results[0].passed).toBe(true);
      expect(results[0].actual).toBe("3");
    });

    it("fails when count does not equal expected", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_count", expected: 5 }],
        rows,
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe("3");
    });

    it("supports greater_than condition", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_count", expected: 2, condition: "greater_than" as const }],
        rows,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports less_than condition", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_count", expected: 5, condition: "less_than" as const }],
        rows,
      );
      expect(results[0].passed).toBe(true);
    });

    it("treats non-array response as empty", () => {
      const results = evaluateAssertions(
        [{ type: "supabase_row_count", expected: 0 }],
        { count: 5 },
      );
      expect(results[0].passed).toBe(true);
      expect(results[0].actual).toBe("0");
    });
  });
});
