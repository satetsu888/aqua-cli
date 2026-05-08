const ENV_VAR_PATTERN = /\{\$([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g;

/**
 * Expand {$VAR} and {$VAR:-default} patterns in a string
 * using process.env values.
 *
 * - {$VAR}            → replaced with process.env.VAR; throws if not set
 * - {$VAR:-default}   → replaced with process.env.VAR; uses "default" if not set
 */
export function expandEnvVars(value: string, context?: string): string {
  return value.replace(ENV_VAR_PATTERN, (match, name: string, defaultValue?: string) => {
    const envValue = process.env[name];
    if (envValue !== undefined) {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    const ctx = context ? ` (in ${context})` : "";
    throw new Error(
      `Environment variable "${name}" is not set and has no default value${ctx}`
    );
  });
}

/**
 * Expand env var patterns in all values of a Record<string, string>.
 */
export function expandEnvVarsInRecord(
  record: Record<string, string>,
  contextPrefix?: string
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const context = contextPrefix ? `${contextPrefix} "${key}"` : `"${key}"`;
    result[key] = expandEnvVars(value, context);
  }
  return result;
}

/**
 * Extract env var references from a string without resolving them.
 * Used for validation (checking if env vars are set).
 */
export function extractEnvVarReferences(
  value: string
): Array<{ name: string; hasDefault: boolean }> {
  const refs: Array<{ name: string; hasDefault: boolean }> = [];
  const pattern = new RegExp(ENV_VAR_PATTERN.source, "g");
  let m;
  while ((m = pattern.exec(value)) !== null) {
    refs.push({ name: m[1], hasDefault: m[2] !== undefined });
  }
  return refs;
}
