import { getJsonPath } from "@aquaqa/cli/utils";
import type { FirebaseAssertion } from "./schemas.js";

export interface AssertionResult {
  type: string;
  expected?: string;
  actual?: string;
  passed: boolean;
  message?: string;
  step_assertion_id?: string;
}

export function evaluateAssertions(
  assertions: FirebaseAssertion[] | undefined,
  response: unknown,
  count?: number,
): AssertionResult[] {
  if (!assertions || assertions.length === 0) return [];

  return assertions.map((assertion) => {
    const a = assertion as Record<string, unknown>;

    switch (assertion.type) {
      case "firebase_field":
        return evaluateFieldAssertion(assertion, response);
      case "firebase_document_exists":
        return evaluateDocumentExistsAssertion(assertion, response);
      case "firebase_count":
        return evaluateCountAssertion(assertion, count ?? 0);
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
  assertion: { type: "firebase_field"; path: string; expected: string; condition?: string; id?: string },
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
    type: "firebase_field",
    expected: assertion.expected,
    actual,
    passed,
    message,
    step_assertion_id: (assertion as Record<string, unknown>).id as string | undefined,
  };
}

function evaluateDocumentExistsAssertion(
  assertion: { type: "firebase_document_exists"; exists?: boolean; id?: string },
  response: unknown,
): AssertionResult {
  const shouldExist = assertion.exists !== false;
  const objectExists = response !== null && response !== undefined;
  const passed = shouldExist === objectExists;

  return {
    type: "firebase_document_exists",
    expected: shouldExist ? "exists" : "not exists",
    actual: objectExists ? "exists" : "not exists",
    passed,
    message: passed
      ? `Document ${shouldExist ? "exists" : "does not exist"} as expected`
      : `Expected document to ${shouldExist ? "exist" : "not exist"}`,
    step_assertion_id: (assertion as Record<string, unknown>).id as string | undefined,
  };
}

function evaluateCountAssertion(
  assertion: { type: "firebase_count"; expected: number; condition?: string; id?: string },
  count: number,
): AssertionResult {
  const condition = assertion.condition ?? "equals";
  const expected = assertion.expected;

  let passed: boolean;
  let message: string;

  switch (condition) {
    case "equals":
      passed = count === expected;
      message = passed
        ? `Count ${count} equals ${expected}`
        : `Expected count to equal ${expected}, got ${count}`;
      break;
    case "greater_than":
      passed = count > expected;
      message = passed
        ? `Count ${count} > ${expected}`
        : `Expected count to be > ${expected}, got ${count}`;
      break;
    case "less_than":
      passed = count < expected;
      message = passed
        ? `Count ${count} < ${expected}`
        : `Expected count to be < ${expected}, got ${count}`;
      break;
    default:
      passed = false;
      message = `Unknown condition: ${condition}`;
  }

  return {
    type: "firebase_count",
    expected: String(expected),
    actual: String(count),
    passed,
    message,
    step_assertion_id: (assertion as Record<string, unknown>).id as string | undefined,
  };
}
