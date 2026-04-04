import { readFile, readdir } from "node:fs/promises";
import { request } from "node:http";
import { join, extname, basename } from "node:path";
import type { SecretEntry } from "./types.js";
import { environmentFileSchema } from "./types.js";
import type { ProviderConfig } from "./resolver-registry.js";
import { getResolver } from "./resolver-registry.js";
import { getProjectRoot } from "../config/projectRoot.js";

const cache = new Map<string, string>();

export function buildSecretCacheKey(
  entry: SecretEntry,
  providerConfig?: ProviderConfig
): string {
  const key: Record<string, unknown> = { type: entry.type, value: entry.value };
  if ("region" in entry) key.region = entry.region;
  if ("json_key" in entry) key.json_key = entry.json_key;
  if ("project" in entry) key.project = entry.project;
  if ("version" in entry) key.version = entry.version;
  if ("field" in entry) key.field = entry.field;
  if ("mount" in entry) key.mount = entry.mount;
  if (providerConfig && Object.keys(providerConfig).length > 0)
    key.provider = providerConfig;
  return JSON.stringify(key);
}

/**
 * Query the remote secret cache server via UDS or Named Pipe.
 * Returns undefined on any failure (graceful degradation).
 */
async function queryRemoteCache(cacheKey: string): Promise<string | undefined> {
  const socketPath = process.env.AQUA_SECRET_CACHE_SOCKET;
  if (!socketPath) return undefined;

  return new Promise<string | undefined>((resolve) => {
    const req = request(
      {
        socketPath,
        path: `/secrets/${encodeURIComponent(cacheKey)}`,
        method: "GET",
        timeout: 2000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(undefined);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", () => resolve(undefined));
      }
    );
    req.on("error", () => resolve(undefined));
    req.on("timeout", () => {
      req.destroy();
      resolve(undefined);
    });
    req.end();
  });
}

/**
 * Get a cached secret value. Returns undefined for literal/env types or cache miss.
 * Checks the local in-memory cache first, then falls back to querying
 * an external cache server via AQUA_SECRET_CACHE_SOCKET if set.
 */
export async function getCachedSecret(
  entry: SecretEntry,
  providerConfig?: ProviderConfig
): Promise<string | undefined> {
  if (entry.type === "literal" || entry.type === "env") return undefined;

  const cacheKey = buildSecretCacheKey(entry, providerConfig);

  // 1. Local in-memory cache
  const local = cache.get(cacheKey);
  if (local !== undefined) return local;

  // 2. Remote cache server (if AQUA_SECRET_CACHE_SOCKET is set)
  const remote = await queryRemoteCache(cacheKey);
  if (remote !== undefined) {
    cache.set(cacheKey, remote); // Populate local cache
    return remote;
  }

  return undefined;
}

/** Store a resolved secret value in the cache. No-op for literal/env types. */
export function setCachedSecret(
  entry: SecretEntry,
  providerConfig: ProviderConfig | undefined,
  value: string
): void {
  if (entry.type === "literal" || entry.type === "env") return;
  cache.set(buildSecretCacheKey(entry, providerConfig), value);
}

/** Clear the entire secret cache. */
export function clearSecretCache(): void {
  cache.clear();
}

/**
 * Pre-resolve all external secrets from environment files and populate the cache.
 * Errors are logged to stderr and skipped (does not block startup).
 */
export async function warmSecretCache(): Promise<{
  resolved: number;
  failed: number;
}> {
  let projectRoot: string;
  try {
    projectRoot = getProjectRoot();
  } catch {
    return { resolved: 0, failed: 0 };
  }

  const envDir = join(projectRoot, ".aqua", "environments");

  let entries: string[];
  try {
    entries = await readdir(envDir);
  } catch {
    return { resolved: 0, failed: 0 };
  }

  const jsonFiles = entries.filter((f) => extname(f) === ".json");
  if (jsonFiles.length === 0) return { resolved: 0, failed: 0 };

  // Collect all unique external secret entries across all environment files
  const toResolve: {
    entry: SecretEntry;
    context: string;
    providerConfig?: ProviderConfig;
  }[] = [];
  const seenKeys = new Set<string>();

  for (const file of jsonFiles) {
    const envName = basename(file, ".json");
    let raw: string;
    try {
      raw = await readFile(join(envDir, file), "utf-8");
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const result = environmentFileSchema.safeParse(parsed);
    if (!result.success) continue;

    const envFile = result.data;
    const secretProviders = envFile.secret_providers;

    // Collect secret entries
    const secretEntries: { key: string; entry: SecretEntry }[] = [];
    if (envFile.secrets) {
      for (const [key, entry] of Object.entries(envFile.secrets)) {
        secretEntries.push({ key, entry });
      }
    }
    // Proxy credentials
    if (envFile.proxy?.username) {
      secretEntries.push({ key: "proxy.username", entry: envFile.proxy.username });
    }
    if (envFile.proxy?.password) {
      secretEntries.push({ key: "proxy.password", entry: envFile.proxy.password });
    }

    for (const { key, entry } of secretEntries) {
      if (entry.type === "literal" || entry.type === "env") continue;

      const providerConfig = secretProviders?.[entry.type];
      const cacheKey = buildSecretCacheKey(entry, providerConfig);
      if (seenKeys.has(cacheKey)) continue;
      seenKeys.add(cacheKey);

      toResolve.push({
        entry,
        context: `secret "${key}" in environment "${envName}"`,
        providerConfig,
      });
    }
  }

  if (toResolve.length === 0) return { resolved: 0, failed: 0 };

  // Check CLI availability for all external types
  const externalTypes = new Set(toResolve.map((r) => r.entry.type));
  const availableTypes = new Set<string>();
  for (const type of externalTypes) {
    const resolver = getResolver(type);
    if (!resolver) continue;
    try {
      const available = await resolver.checkAvailable();
      if (available) {
        availableTypes.add(type);
      } else {
        process.stderr.write(
          `Warning: ${resolver.cliName} is not available. Secrets with type "${type}" will be resolved at execution time.\n`
        );
      }
    } catch {
      // Skip this type
    }
  }

  const results = await Promise.allSettled(
    toResolve.map(async ({ entry, context, providerConfig }) => {
      if (!availableTypes.has(entry.type)) {
        throw new Error("type_unavailable");
      }

      const resolver = getResolver(entry.type);
      if (!resolver) {
        throw new Error("no_resolver");
      }

      const value = await resolver.resolve(entry, context, providerConfig);
      setCachedSecret(entry, providerConfig, value);
    })
  );

  let resolved = 0;
  let failed = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      resolved++;
    } else {
      failed++;
      const message = result.reason?.message ?? String(result.reason);
      if (message !== "type_unavailable" && message !== "no_resolver") {
        const context = toResolve[i].context;
        process.stderr.write(
          `Warning: Failed to pre-resolve ${context}: ${message}\n`
        );
      }
    }
  }

  return { resolved, failed };
}
