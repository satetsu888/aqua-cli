import { describe, it, expect } from "vitest";
import { evaluateAssertions } from "./assertions.js";

describe("evaluateAssertions", () => {
  it("returns empty array when no assertions", () => {
    expect(evaluateAssertions(undefined, {})).toEqual([]);
    expect(evaluateAssertions([], {})).toEqual([]);
  });

  describe("firebase_field", () => {
    const response = {
      id: "doc_123",
      status: "active",
      total: 5000,
      tags: ["premium", "verified"],
      metadata: { plan: "pro", region: "asia" },
      items: [{ name: "Item A", price: 1000 }],
      deletedAt: null,
    };

    it("passes when field equals expected", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "status", expected: "active" }],
        response,
      );
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it("fails when field does not equal expected", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "status", expected: "inactive" }],
        response,
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe("active");
    });

    it("supports not_equals condition — pass", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "status", expected: "inactive", condition: "not_equals" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports not_equals condition — fail", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "status", expected: "active", condition: "not_equals" as const }],
        response,
      );
      expect(results[0].passed).toBe(false);
    });

    it("supports contains condition — pass", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "id", expected: "doc", condition: "contains" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports contains condition — fail", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "id", expected: "xyz", condition: "contains" as const }],
        response,
      );
      expect(results[0].passed).toBe(false);
    });

    it("supports exists condition — pass", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "status", expected: "", condition: "exists" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports exists condition — fail", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "nonexistent", expected: "", condition: "exists" as const }],
        response,
      );
      expect(results[0].passed).toBe(false);
    });

    it("supports not_exists condition — pass", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "nonexistent", expected: "", condition: "not_exists" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports not_exists condition — fail", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "status", expected: "", condition: "not_exists" as const }],
        response,
      );
      expect(results[0].passed).toBe(false);
    });

    it("supports greater_than condition — pass", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "total", expected: "3000", condition: "greater_than" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports greater_than condition — fail", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "total", expected: "9000", condition: "greater_than" as const }],
        response,
      );
      expect(results[0].passed).toBe(false);
    });

    it("supports less_than condition — pass", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "total", expected: "9000", condition: "less_than" as const }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("supports less_than condition — fail", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "total", expected: "3000", condition: "less_than" as const }],
        response,
      );
      expect(results[0].passed).toBe(false);
    });

    it("resolves nested dot paths", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "metadata.plan", expected: "pro" }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });

    it("resolves array index paths", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_field", path: "items[0].name", expected: "Item A" }],
        response,
      );
      expect(results[0].passed).toBe(true);
    });
  });

  describe("firebase_document_exists", () => {
    it("passes when document exists and exists=true", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_document_exists", exists: true }],
        { id: "doc_123" },
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when document is null and exists=true", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_document_exists", exists: true }],
        null,
      );
      expect(results[0].passed).toBe(false);
    });

    it("passes when document is null and exists=false", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_document_exists", exists: false }],
        null,
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when document exists and exists=false", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_document_exists", exists: false }],
        { id: "doc_123" },
      );
      expect(results[0].passed).toBe(false);
    });
  });

  describe("firebase_count", () => {
    it("passes when count equals expected", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_count", expected: 3, condition: "equals" as const }],
        {},
        3,
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when count does not equal expected", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_count", expected: 5, condition: "equals" as const }],
        {},
        3,
      );
      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe("3");
    });

    it("passes when count greater_than expected", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_count", expected: 2, condition: "greater_than" as const }],
        {},
        3,
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when count not greater_than expected", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_count", expected: 5, condition: "greater_than" as const }],
        {},
        3,
      );
      expect(results[0].passed).toBe(false);
    });

    it("passes when count less_than expected", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_count", expected: 5, condition: "less_than" as const }],
        {},
        3,
      );
      expect(results[0].passed).toBe(true);
    });

    it("fails when count not less_than expected", () => {
      const results = evaluateAssertions(
        [{ type: "firebase_count", expected: 2, condition: "less_than" as const }],
        {},
        3,
      );
      expect(results[0].passed).toBe(false);
    });
  });
});
