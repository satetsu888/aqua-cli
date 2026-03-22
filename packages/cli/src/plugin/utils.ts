/**
 * Shared utilities for plugin development.
 * These are pure functions with no dependencies on upper modules (driver, executor, mcp).
 */

/**
 * Simple JSONPath resolver. Supports $.foo.bar and $.foo[0].bar syntax.
 */
export function getJsonPath(obj: unknown, path: string): unknown {
  const parts = path
    .replace(/^\$\.?/, "")
    .split(/\.|\[(\d+)\]/)
    .filter(Boolean);

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Extract values from a response object using JSONPath expressions.
 * @param extract - Map of variable_name -> json_path expression
 * @param response - The response object to extract from
 * @returns Extracted key-value pairs
 */
export function extractValues(
  extract: Record<string, string> | undefined,
  response: unknown
): Record<string, string> {
  if (!extract) return {};

  const result: Record<string, string> = {};
  for (const [key, path] of Object.entries(extract)) {
    const value = getJsonPath(response, path);
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}
