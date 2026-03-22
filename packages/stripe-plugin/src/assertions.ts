import { getJsonPath } from "@aquaqa/cli/utils";
import type { StripeAssertion } from "./schemas.js";

export interface AssertionResult {
  type: string;
  expected?: string;
  actual?: string;
  passed: boolean;
  message?: string;
  step_assertion_id?: string;
}

export function evaluateAssertions(
  assertions: StripeAssertion[] | undefined,
  response: unknown,
): AssertionResult[] {
  if (!assertions || assertions.length === 0) return [];

  return assertions.map((assertion) => {
    const a = assertion as Record<string, unknown>;

    switch (assertion.type) {
      case "stripe_field":
        return evaluateFieldAssertion(assertion, response);
      case "stripe_object_exists":
        return evaluateObjectExistsAssertion(assertion, response);
      default:
        return {
          type: (a.type as string) ?? "unknown",
          passed: false,
          message: `Unknown assertion type: ${a.type}`,
          step_assertion_id: a.id as string | undefined,
        };
    }
  });
}

function evaluateFieldAssertion(
  assertion: { type: "stripe_field"; path: string; expected: string; condition?: string; id?: string },
  response: unknown,
): AssertionResult {
  const value = getJsonPath(response, assertion.path);
  const actual = value !== undefined && value !== null ? String(value) : undefined;
  const condition = assertion.condition ?? "equals";

  let passed: boolean;
  let message: string;

  switch (condition) {
    case "equals":
      passed = actual === assertion.expected;
      message = passed
        ? `${assertion.path} equals "${assertion.expected}"`
        : `Expected ${assertion.path} to equal "${assertion.expected}", got "${actual}"`;
      break;
    case "not_equals":
      passed = actual !== assertion.expected;
      message = passed
        ? `${assertion.path} does not equal "${assertion.expected}"`
        : `Expected ${assertion.path} to not equal "${assertion.expected}"`;
      break;
    case "contains":
      passed = actual !== undefined && actual.includes(assertion.expected);
      message = passed
        ? `${assertion.path} contains "${assertion.expected}"`
        : `Expected ${assertion.path} to contain "${assertion.expected}", got "${actual}"`;
      break;
    case "exists":
      passed = value !== undefined && value !== null;
      message = passed
        ? `${assertion.path} exists`
        : `Expected ${assertion.path} to exist`;
      break;
    case "not_exists":
      passed = value === undefined || value === null;
      message = passed
        ? `${assertion.path} does not exist`
        : `Expected ${assertion.path} to not exist, but got "${actual}"`;
      break;
    case "greater_than":
      passed = actual !== undefined && Number(actual) > Number(assertion.expected);
      message = passed
        ? `${assertion.path} (${actual}) > ${assertion.expected}`
        : `Expected ${assertion.path} to be > ${assertion.expected}, got "${actual}"`;
      break;
    case "less_than":
      passed = actual !== undefined && Number(actual) < Number(assertion.expected);
      message = passed
        ? `${assertion.path} (${actual}) < ${assertion.expected}`
        : `Expected ${assertion.path} to be < ${assertion.expected}, got "${actual}"`;
      break;
    default:
      passed = false;
      message = `Unknown condition: ${condition}`;
  }

  return {
    type: "stripe_field",
    expected: assertion.expected,
    actual,
    passed,
    message,
    step_assertion_id: (assertion as Record<string, unknown>).id as string | undefined,
  };
}

function evaluateObjectExistsAssertion(
  assertion: { type: "stripe_object_exists"; exists?: boolean; id?: string },
  response: unknown,
): AssertionResult {
  const shouldExist = assertion.exists !== false;
  const objectExists = response !== null && response !== undefined;
  const passed = shouldExist === objectExists;

  return {
    type: "stripe_object_exists",
    expected: shouldExist ? "exists" : "not exists",
    actual: objectExists ? "exists" : "not exists",
    passed,
    message: passed
      ? `Object ${shouldExist ? "exists" : "does not exist"} as expected`
      : `Expected object to ${shouldExist ? "exist" : "not exist"}`,
    step_assertion_id: (assertion as Record<string, unknown>).id as string | undefined,
  };
}
