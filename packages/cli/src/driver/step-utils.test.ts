import { describe, it, expect } from "vitest";
import { resolveStepOrder, checkStepDependencies, evaluateCondition } from "./step-utils.js";
import type { Step, StepResult } from "../qa-plan/types.js";

function makeStep(overrides: Partial<Step> & { step_key: string }): Step {
  return {
    id: overrides.step_key,
    action: "http_request",
    config: { method: "GET", url: "http://example.com" },
    sort_order: 0,
    ...overrides,
  };
}

function makeResult(stepKey: string, status: StepResult["status"]): StepResult {
  return {
    stepKey,
    scenarioName: "test",
    action: "http_request",
    status,
    startedAt: new Date(),
    finishedAt: new Date(),
  };
}

describe("resolveStepOrder", () => {
  it("returns steps in original order when no dependencies", () => {
    const steps = [
      makeStep({ step_key: "a", sort_order: 0 }),
      makeStep({ step_key: "b", sort_order: 1 }),
      makeStep({ step_key: "c", sort_order: 2 }),
    ];

    const ordered = resolveStepOrder(steps);
    expect(ordered.map((s) => s.step_key)).toEqual(["a", "b", "c"]);
  });

  it("reorders steps to satisfy dependencies", () => {
    const steps = [
      makeStep({ step_key: "b", depends_on: ["a"], sort_order: 0 }),
      makeStep({ step_key: "a", sort_order: 1 }),
    ];

    const ordered = resolveStepOrder(steps);
    expect(ordered.map((s) => s.step_key)).toEqual(["a", "b"]);
  });

  it("handles chain dependencies (a -> b -> c)", () => {
    const steps = [
      makeStep({ step_key: "c", depends_on: ["b"], sort_order: 0 }),
      makeStep({ step_key: "b", depends_on: ["a"], sort_order: 1 }),
      makeStep({ step_key: "a", sort_order: 2 }),
    ];

    const ordered = resolveStepOrder(steps);
    expect(ordered.map((s) => s.step_key)).toEqual(["a", "b", "c"]);
  });

  it("handles multiple dependencies", () => {
    const steps = [
      makeStep({ step_key: "c", depends_on: ["a", "b"], sort_order: 0 }),
      makeStep({ step_key: "a", sort_order: 1 }),
      makeStep({ step_key: "b", sort_order: 2 }),
    ];

    const ordered = resolveStepOrder(steps);
    const keys = ordered.map((s) => s.step_key);
    expect(keys.indexOf("a")).toBeLessThan(keys.indexOf("c"));
    expect(keys.indexOf("b")).toBeLessThan(keys.indexOf("c"));
  });

  it("ignores dependencies on steps not in the list (cross-scenario deps)", () => {
    const steps = [
      makeStep({ step_key: "b", depends_on: ["external_step"], sort_order: 0 }),
      makeStep({ step_key: "a", sort_order: 1 }),
    ];

    const ordered = resolveStepOrder(steps);
    expect(ordered.map((s) => s.step_key)).toEqual(["b", "a"]);
  });

  it("returns empty array for empty input", () => {
    expect(resolveStepOrder([])).toEqual([]);
  });
});

describe("checkStepDependencies", () => {
  it("returns true when step has no dependencies", () => {
    const step = makeStep({ step_key: "a" });
    const completed = new Map<string, StepResult>();

    expect(checkStepDependencies(step, completed)).toBe(true);
  });

  it("returns true when all dependencies are passed", () => {
    const step = makeStep({ step_key: "c", depends_on: ["a", "b"] });
    const completed = new Map<string, StepResult>([
      ["a", makeResult("a", "passed")],
      ["b", makeResult("b", "passed")],
    ]);

    expect(checkStepDependencies(step, completed)).toBe(true);
  });

  it("returns false when a dependency is failed", () => {
    const step = makeStep({ step_key: "b", depends_on: ["a"] });
    const completed = new Map<string, StepResult>([
      ["a", makeResult("a", "failed")],
    ]);

    expect(checkStepDependencies(step, completed)).toBe(false);
  });

  it("returns false when a dependency is skipped", () => {
    const step = makeStep({ step_key: "b", depends_on: ["a"] });
    const completed = new Map<string, StepResult>([
      ["a", makeResult("a", "skipped")],
    ]);

    expect(checkStepDependencies(step, completed)).toBe(false);
  });

  it("returns false when a dependency is error", () => {
    const step = makeStep({ step_key: "b", depends_on: ["a"] });
    const completed = new Map<string, StepResult>([
      ["a", makeResult("a", "error")],
    ]);

    expect(checkStepDependencies(step, completed)).toBe(false);
  });

  it("returns false when a dependency is not yet completed", () => {
    const step = makeStep({ step_key: "b", depends_on: ["a"] });
    const completed = new Map<string, StepResult>();

    expect(checkStepDependencies(step, completed)).toBe(false);
  });

  it("returns false when one of multiple dependencies fails", () => {
    const step = makeStep({ step_key: "c", depends_on: ["a", "b"] });
    const completed = new Map<string, StepResult>([
      ["a", makeResult("a", "passed")],
      ["b", makeResult("b", "failed")],
    ]);

    expect(checkStepDependencies(step, completed)).toBe(false);
  });
});

describe("evaluateCondition", () => {
  describe("variable_equals", () => {
    it("returns null when variable matches expected value", () => {
      const result = evaluateCondition(
        { variable_equals: { name: "status", value: "active" } },
        { status: "active" }
      );
      expect(result).toBeNull();
    });

    it("returns message when variable does not match", () => {
      const result = evaluateCondition(
        { variable_equals: { name: "status", value: "active" } },
        { status: "inactive" }
      );
      expect(result).toContain("Condition not met");
      expect(result).toContain("'active'");
      expect(result).toContain("'inactive'");
    });

    it("returns message when variable is undefined", () => {
      const result = evaluateCondition(
        { variable_equals: { name: "status", value: "active" } },
        {}
      );
      expect(result).toContain("Condition not met");
      expect(result).toContain("undefined");
    });
  });

  describe("variable_not_equals", () => {
    it("returns null when variable does not match", () => {
      const result = evaluateCondition(
        { variable_not_equals: { name: "status", value: "active" } },
        { status: "inactive" }
      );
      expect(result).toBeNull();
    });

    it("returns null when variable is undefined", () => {
      const result = evaluateCondition(
        { variable_not_equals: { name: "status", value: "active" } },
        {}
      );
      expect(result).toBeNull();
    });

    it("returns message when variable matches the excluded value", () => {
      const result = evaluateCondition(
        { variable_not_equals: { name: "status", value: "active" } },
        { status: "active" }
      );
      expect(result).toContain("Condition not met");
      expect(result).toContain("not equal");
    });
  });
});
