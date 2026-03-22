/**
 * Parse a comma-separated bypass string into normalized patterns.
 */
export function parseBypassPatterns(bypass: string): string[] {
  return bypass
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Check if a URL's hostname matches any bypass pattern.
 * Returns true if the request should bypass the proxy.
 *
 * Supports:
 * - Exact hostname: "localhost" matches localhost (any port)
 * - Leading dot suffix: ".internal.com" matches api.internal.com
 * - Host with port: "localhost:3000" matches only localhost:3000
 * - Wildcard: "*" matches all
 */
export function shouldBypassProxy(url: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;

  let hostname: string;
  let hostWithPort: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
    hostWithPort = parsed.host.toLowerCase();
  } catch {
    return false;
  }

  for (const pattern of patterns) {
    if (pattern === "*") return true;

    if (pattern.includes(":")) {
      if (hostWithPort === pattern) return true;
    } else if (pattern.startsWith(".")) {
      if (hostname.endsWith(pattern)) return true;
    } else {
      if (hostname === pattern) return true;
    }
  }

  return false;
}
