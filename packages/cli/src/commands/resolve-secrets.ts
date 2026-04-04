import { readFile, readdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { environmentFileSchema } from "../environment/types.js";
import type { SecretEntry } from "../environment/types.js";
import { getResolver, type ProviderConfig } from "../environment/resolver-registry.js";
import { buildSecretCacheKey } from "../environment/secret-cache.js";

// Ensure resolvers are registered
import "../environment/index.js";

interface ResolvedSecret {
  cache_key: string;
  value: string;
}

interface SecretError {
  cache_key: string;
  provider: string;
  error_type: "auth_required" | "resolution_failed";
  message: string;
  secret_ref: string;
  variable_name: string;
  environment: string;
}

interface ResolveSecretsOutput {
  secrets: Record<string, string>;
  errors: SecretError[];
}

/** Auth-related error patterns per provider (matches existing resolver error detection) */
const AUTH_ERROR_PATTERNS: Record<string, string[]> = {
  op: ["not currently signed in"],
  aws_sm: ["Unable to locate credentials", "ExpiredToken"],
  gcp_sm: ["not authenticated", "UNAUTHENTICATED", "login"],
  hcv: ["permission denied", "missing client token"],
};

function isAuthError(provider: string, message: string): boolean {
  const patterns = AUTH_ERROR_PATTERNS[provider];
  if (!patterns) return false;
  return patterns.some((p) => message.includes(p));
}

/** Build a human-readable secret reference for UI display */
function buildSecretRef(entry: SecretEntry): string {
  switch (entry.type) {
    case "op":
      return entry.value; // e.g., "op://vault/item/field"
    case "aws_sm": {
      const e = entry as Extract<SecretEntry, { type: "aws_sm" }>;
      let ref = e.value;
      if (e.region) ref += ` (region: ${e.region})`;
      if (e.json_key) ref += ` [${e.json_key}]`;
      return ref;
    }
    case "gcp_sm": {
      const e = entry as Extract<SecretEntry, { type: "gcp_sm" }>;
      let ref = e.value;
      if (e.project) ref += ` (project: ${e.project})`;
      if (e.version) ref += ` @${e.version}`;
      if (e.json_key) ref += ` [${e.json_key}]`;
      return ref;
    }
    case "hcv": {
      const e = entry as Extract<SecretEntry, { type: "hcv" }>;
      const mount = e.mount ?? "secret";
      let ref = `${mount}/${e.value}`;
      if (e.field) ref += ` [${e.field}]`;
      return ref;
    }
    default:
      return entry.value;
  }
}

export async function runResolveSecrets(opts: {
  project?: string;
  env?: string;
}): Promise<void> {
  const projectRoot = opts.project ?? process.cwd();
  const envDir = join(projectRoot, ".aqua", "environments");

  let entries: string[];
  try {
    entries = await readdir(envDir);
  } catch {
    // No environments directory — output empty result
    const output: ResolveSecretsOutput = { secrets: {}, errors: [] };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  let jsonFiles = entries.filter((f) => extname(f) === ".json");
  if (opts.env) {
    jsonFiles = jsonFiles.filter((f) => basename(f, ".json") === opts.env);
    if (jsonFiles.length === 0) {
      process.stderr.write(
        `Warning: Environment "${opts.env}" not found in ${envDir}\n`
      );
    }
  }

  if (jsonFiles.length === 0) {
    const output: ResolveSecretsOutput = { secrets: {}, errors: [] };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Collect all external secrets to resolve
  const toResolve: {
    entry: SecretEntry;
    cacheKey: string;
    variableName: string;
    envName: string;
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
        cacheKey,
        variableName: key,
        envName,
        providerConfig,
      });
    }
  }

  if (toResolve.length === 0) {
    const output: ResolveSecretsOutput = { secrets: {}, errors: [] };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Check CLI availability
  const externalTypes = new Set(toResolve.map((r) => r.entry.type));
  const availableTypes = new Set<string>();
  for (const type of externalTypes) {
    const resolver = getResolver(type);
    if (!resolver) continue;
    try {
      if (await resolver.checkAvailable()) {
        availableTypes.add(type);
      }
    } catch {
      // Skip
    }
  }

  // Resolve all secrets concurrently
  const output: ResolveSecretsOutput = { secrets: {}, errors: [] };

  const results = await Promise.allSettled(
    toResolve.map(async (item) => {
      if (!availableTypes.has(item.entry.type)) {
        const resolver = getResolver(item.entry.type);
        return {
          item,
          error: `${resolver?.cliName ?? item.entry.type} is not installed`,
          errorType: "resolution_failed" as const,
        };
      }

      const resolver = getResolver(item.entry.type);
      if (!resolver) {
        return {
          item,
          error: `No resolver for type "${item.entry.type}"`,
          errorType: "resolution_failed" as const,
        };
      }

      try {
        const value = await resolver.resolve(
          item.entry,
          `secret "${item.variableName}" in environment "${item.envName}"`,
          item.providerConfig
        );
        return { item, value };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorType = isAuthError(item.entry.type, message)
          ? ("auth_required" as const)
          : ("resolution_failed" as const);
        return { item, error: message, errorType };
      }
    })
  );

  for (const result of results) {
    if (result.status === "rejected") continue;

    const { item, value, error, errorType } = result.value as {
      item: (typeof toResolve)[number];
      value?: string;
      error?: string;
      errorType?: "auth_required" | "resolution_failed";
    };

    if (value !== undefined) {
      output.secrets[item.cacheKey] = value;
    } else if (error && errorType) {
      output.errors.push({
        cache_key: item.cacheKey,
        provider: item.entry.type,
        error_type: errorType,
        message: error,
        secret_ref: buildSecretRef(item.entry),
        variable_name: item.variableName,
        environment: item.envName,
      });
    }
  }

  console.log(JSON.stringify(output, null, 2));
}
