import { generateTOTP } from "./totp.js";

/**
 * Expand {{variable}} and {{totp:variable}} placeholders in a string
 * using the provided variables map.
 *
 * - {{variable}}       → replaced with variables[variable]
 * - {{totp:variable}}  → variables[variable] is treated as a Base32 TOTP secret;
 *                         a one-time code is computed and substituted
 */
export function expandTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(TEMPLATE_PATTERN, (match, key: string) => {
    if (key.startsWith("totp:")) {
      const varName = key.slice(5);
      if (varName in variables) {
        return generateTOTP(variables[varName]);
      }
      return match;
    }
    if (key in variables) {
      return variables[key];
    }
    return match; // leave unresolved placeholders as-is
  });
}

const TEMPLATE_PATTERN = /\{\{(totp:\w+|\w+)\}\}/g;

/**
 * Collect all variable names referenced by {{variable}} and {{totp:variable}}
 * placeholders in an object tree.
 */
export function collectVariableReferences(obj: unknown): Set<string> {
  const refs = new Set<string>();
  collectFromValue(obj, refs);
  return refs;
}

function collectFromValue(obj: unknown, refs: Set<string>): void {
  if (typeof obj === "string") {
    for (const match of obj.matchAll(TEMPLATE_PATTERN)) {
      const key = match[1];
      if (key.startsWith("totp:")) {
        refs.add(key.slice(5));
      } else {
        refs.add(key);
      }
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectFromValue(item, refs);
    }
    return;
  }
  if (obj !== null && typeof obj === "object") {
    for (const value of Object.values(obj)) {
      collectFromValue(value, refs);
    }
  }
}

/**
 * Deep-expand all string values in an object tree.
 */
export function expandObject<T>(obj: T, variables: Record<string, string>): T {
  if (typeof obj === "string") {
    return expandTemplate(obj, variables) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => expandObject(item, variables)) as T;
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandObject(value, variables);
    }
    return result as T;
  }
  return obj;
}
