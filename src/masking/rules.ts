import type { MaskRule, MaskContext, MaskTargetKind } from "./types.js";
import { MASK_PLACEHOLDER } from "./types.js";

/**
 * Masks secret keys in the environment dict.
 */
export const secretKeysRule: MaskRule = {
  name: "secret-keys",
  targets: ["environment"],
  apply(
    _kind: MaskTargetKind,
    data: unknown,
    ctx: MaskContext
  ): unknown {
    const env = data as Record<string, string>;
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      masked[key] = ctx.secretKeys.has(key) ? MASK_PLACEHOLDER : value;
    }
    return masked;
  },
};

/**
 * Masks Authorization header values in HTTP request artifacts.
 */
export const httpAuthHeaderRule: MaskRule = {
  name: "http-auth-header",
  targets: ["http_request"],
  apply(
    _kind: MaskTargetKind,
    data: unknown,
    _ctx: MaskContext
  ): unknown {
    return maskHeaders(data as Record<string, unknown>, ["authorization"]);
  },
};

/**
 * Masks Set-Cookie header values in HTTP response artifacts.
 */
export const httpSetCookieRule: MaskRule = {
  name: "http-set-cookie",
  targets: ["http_response"],
  apply(
    _kind: MaskTargetKind,
    data: unknown,
    _ctx: MaskContext
  ): unknown {
    return maskHeaders(data as Record<string, unknown>, ["set-cookie"]);
  },
};

/**
 * Masks value attributes of <input type="password"> elements in DOM snapshots.
 */
export const domPasswordRule: MaskRule = {
  name: "dom-password",
  targets: ["dom_snapshot"],
  apply(
    _kind: MaskTargetKind,
    data: unknown,
    _ctx: MaskContext
  ): unknown {
    if (typeof data !== "string") return data;
    // Match <input ...type="password"... value="..."> in any attribute order
    return data.replace(
      /(<input\b[^>]*type\s*=\s*["']password["'][^>]*)\bvalue\s*=\s*["'][^"']*["']/gi,
      `$1value="${MASK_PLACEHOLDER}"`
    );
  },
};

/** Minimum secret value length to avoid false positives in scanning */
const MIN_SCAN_LENGTH = 4;

/**
 * Scans all string content for known secret values and replaces them.
 * Acts as a safety net for values that other rules may miss.
 */
export const secretValueScanRule: MaskRule = {
  name: "secret-value-scan",
  targets: ["http_request", "http_response", "dom_snapshot"],
  apply(
    kind: MaskTargetKind,
    data: unknown,
    ctx: MaskContext
  ): unknown {
    if (ctx.secretValues.size === 0) return data;

    const valuesToMask = [...ctx.secretValues].filter(
      (v) => v.length >= MIN_SCAN_LENGTH
    );
    if (valuesToMask.length === 0) return data;

    // Plain string targets: dom_snapshot
    if (kind === "dom_snapshot" && typeof data === "string") {
      return replaceSecretValues(data, valuesToMask);
    }

    // For JSON-structured artifacts, deep-scan all string values
    return deepScanObject(data, valuesToMask);
  },
};

// --- helpers ---

function maskHeaders(
  obj: Record<string, unknown>,
  headerNames: string[]
): Record<string, unknown> {
  if (!obj.headers || typeof obj.headers !== "object") return obj;

  const headers = obj.headers as Record<string, unknown>;
  const masked: Record<string, unknown> = {};
  const lowerNames = headerNames.map((n) => n.toLowerCase());

  for (const [key, value] of Object.entries(headers)) {
    masked[key] = lowerNames.includes(key.toLowerCase())
      ? MASK_PLACEHOLDER
      : value;
  }

  return { ...obj, headers: masked };
}

function replaceSecretValues(str: string, values: string[]): string {
  let result = str;
  for (const value of values) {
    // Use split+join for literal string replacement (no regex escaping needed)
    result = result.split(value).join(MASK_PLACEHOLDER);
  }
  return result;
}

function deepScanObject(obj: unknown, values: string[]): unknown {
  if (typeof obj === "string") {
    return replaceSecretValues(obj, values);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepScanObject(item, values));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepScanObject(value, values);
    }
    return result;
  }
  return obj;
}
