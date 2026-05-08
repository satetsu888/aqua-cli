import { readFile, readdir, writeFile, mkdir, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { getProjectRoot } from "../config/projectRoot.js";
import { environmentFileSchema } from "./types.js";
import type { EnvironmentFile, ResolvedEnvironment, SecretEntry, ResolvedProxyConfig } from "./types.js";
import { getResolver, type ProviderConfig } from "./resolver-registry.js";
import { getCachedSecret, setCachedSecret } from "./secret-cache.js";
import { expandEnvVars, expandEnvVarsInRecord, extractEnvVarReferences } from "./env-expand.js";

/**
 * Load and resolve an environment file by name.
 * Looks for `.aqua/environments/{envName}.json` under the project root.
 */
export async function loadEnvironment(
  envName: string,
  requiredKeys?: Set<string>
): Promise<ResolvedEnvironment> {
  const projectRoot = getProjectRoot();
  const filePath = join(projectRoot, ".aqua", "environments", `${envName}.json`);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    throw new Error(
      `Environment file not found: ${filePath}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in environment file: ${filePath}`);
  }

  const result = environmentFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid environment file schema: ${result.error.message}`
    );
  }

  return resolveEnvironment(result.data, requiredKeys);
}

/**
 * Resolve a single SecretEntry to its plain string value.
 */
async function resolveSecretEntry(
  entry: SecretEntry,
  context: string,
  secretProviders?: Record<string, ProviderConfig>,
): Promise<string> {
  switch (entry.type) {
    case "literal":
      return entry.value;
    case "env": {
      const envValue = process.env[entry.value];
      if (envValue === undefined) {
        throw new Error(
          `Environment variable "${entry.value}" is not set (required by ${context})`
        );
      }
      return envValue;
    }
    default: {
      const providerConfig = secretProviders?.[entry.type];
      const cached = await getCachedSecret(entry, providerConfig);
      if (cached !== undefined) return cached;

      const resolver = getResolver(entry.type);
      if (!resolver) {
        throw new Error(`Unknown secret type: "${entry.type}" in ${context}`);
      }
      const resolved = await resolver.resolve(entry, context, providerConfig);
      setCachedSecret(entry, providerConfig, resolved);
      return resolved;
    }
  }
}

/**
 * Check that all required external CLI tools are available before resolving.
 */
async function ensureResolversAvailable(entries: SecretEntry[]): Promise<void> {
  const externalTypes = new Set(
    entries
      .map((e) => e.type)
      .filter((t) => t !== "literal" && t !== "env")
  );

  for (const type of externalTypes) {
    const resolver = getResolver(type);
    if (!resolver) continue;
    const available = await resolver.checkAvailable();
    if (!available) {
      throw new Error(
        `${resolver.cliName} is not installed. ` +
          `This environment includes secrets with type "${type}" that require ${resolver.cliName}.\n` +
          `Install it from: ${resolver.installUrl}`
      );
    }
  }
}

/**
 * Resolve secrets in an EnvironmentFile to plain values.
 * If requiredKeys is provided, only secrets whose keys are in the set will be resolved.
 */
export async function resolveEnvironment(
  envFile: EnvironmentFile,
  requiredKeys?: Set<string>
): Promise<ResolvedEnvironment> {
  const variables: Record<string, string> = envFile.variables
    ? expandEnvVarsInRecord(envFile.variables, "variable")
    : {};
  const secretKeys = new Set<string>();
  const secretValues = new Set<string>();

  // Filter secrets to only those required by the plan
  const secretEntries = envFile.secrets
    ? Object.entries(envFile.secrets).filter(
        ([key]) => !requiredKeys || requiredKeys.has(key)
      )
    : [];

  // Collect all SecretEntry values to check CLI availability once
  const allEntries: SecretEntry[] = [
    ...secretEntries.map(([, entry]) => entry),
    ...(envFile.proxy?.username ? [envFile.proxy.username] : []),
    ...(envFile.proxy?.password ? [envFile.proxy.password] : []),
  ];
  await ensureResolversAvailable(allEntries);

  const secretProviders = envFile.secret_providers;

  for (const [key, entry] of secretEntries) {
    secretKeys.add(key);
    const resolved = await resolveSecretEntry(entry, `secret "${key}"`, secretProviders);
    variables[key] = resolved;
    secretValues.add(resolved);
  }

  // Resolve proxy configuration
  let proxy: ResolvedProxyConfig | undefined;
  if (envFile.proxy) {
    proxy = {
      server: expandEnvVars(envFile.proxy.server, "proxy server"),
      bypass: envFile.proxy.bypass
        ? expandEnvVars(envFile.proxy.bypass, "proxy bypass")
        : undefined,
    };
    if (envFile.proxy.username) {
      proxy.username = await resolveSecretEntry(envFile.proxy.username, "proxy username", secretProviders);
    }
    if (envFile.proxy.password) {
      const pw = await resolveSecretEntry(envFile.proxy.password, "proxy password", secretProviders);
      proxy.password = pw;
      secretValues.add(pw);
    }
    if (envFile.proxy.ca_cert_path) {
      proxy.caCert = readFileSync(envFile.proxy.ca_cert_path);
    }
    if (envFile.proxy.proxy_ca_cert_path) {
      proxy.proxyCaCert = readFileSync(envFile.proxy.proxy_ca_cert_path);
    }
    if (envFile.proxy.reject_unauthorized !== undefined) {
      proxy.rejectUnauthorized = envFile.proxy.reject_unauthorized;
    }
  }

  return { variables, secretKeys, secretValues, proxy };
}

export interface EnvironmentSummary {
  name: string;
  notes?: string;
}

/**
 * List available environments by scanning `.aqua/environments/*.json`.
 * Returns name and notes for each environment.
 */
export async function listEnvironments(): Promise<EnvironmentSummary[]> {
  const projectRoot = getProjectRoot();
  const envDir = join(projectRoot, ".aqua", "environments");

  let entries: string[];
  try {
    entries = await readdir(envDir);
  } catch {
    return [];
  }

  const jsonFiles = entries
    .filter((f) => extname(f) === ".json")
    .sort();

  const results: EnvironmentSummary[] = [];
  for (const file of jsonFiles) {
    const name = basename(file, ".json");
    let notes: string | undefined;
    try {
      const raw = await readFile(join(envDir, file), "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed?.notes === "string" && parsed.notes.length > 0) {
        notes = parsed.notes;
      }
    } catch {
      // File is unreadable or invalid JSON — still include in list
    }
    results.push({ name, notes });
  }

  return results;
}

/**
 * Validate secret entries using the resolver registry.
 */
function validateSecretEntries(
  entries: [string, SecretEntry][],
  labelPrefix: string,
  issues: ValidationIssue[],
  secretProviders?: Record<string, ProviderConfig>,
): void {
  for (const [key, entry] of entries) {
    if (entry.type === "env") {
      if (process.env[entry.value] === undefined) {
        issues.push({
          severity: "warning",
          message: `${labelPrefix}"${key}": environment variable "${entry.value}" is not set`,
        });
      }
    } else if (entry.type !== "literal") {
      const resolver = getResolver(entry.type);
      if (resolver) {
        const entryIssues = resolver.validate(entry, secretProviders?.[entry.type]);
        for (const issue of entryIssues) {
          issues.push({
            severity: issue.severity,
            message: `${labelPrefix}"${key}": ${issue.message}`,
          });
        }
      }
    }
  }
}

/**
 * Load and parse an environment file without resolving secrets.
 * Returns the parsed file and any validation issues found.
 */
export async function validateEnvironment(
  envName: string
): Promise<ValidationResult> {
  const projectRoot = getProjectRoot();
  const filePath = join(projectRoot, ".aqua", "environments", `${envName}.json`);
  const issues: ValidationIssue[] = [];

  // Check file exists
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return {
      valid: false,
      filePath,
      issues: [{ severity: "error", message: `File not found: ${filePath}` }],
    };
  }

  // Check JSON parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      valid: false,
      filePath,
      issues: [
        {
          severity: "error",
          message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  // Check schema
  const result = environmentFileSchema.safeParse(parsed);
  if (!result.success) {
    return {
      valid: false,
      filePath,
      issues: result.error.issues.map((i) => ({
        severity: "error" as const,
        message: `${i.path.join(".")}: ${i.message}`,
      })),
    };
  }

  const envFile = result.data;

  // Collect all SecretEntry values for CLI availability checks
  const allSecretEntries: SecretEntry[] = [
    ...Object.values(envFile.secrets ?? {}),
    ...(envFile.proxy?.username ? [envFile.proxy.username] : []),
    ...(envFile.proxy?.password ? [envFile.proxy.password] : []),
  ];

  // Check CLI availability for all external resolver types
  const externalTypes = new Set(
    allSecretEntries
      .map((e) => e.type)
      .filter((t) => t !== "literal" && t !== "env")
  );
  for (const type of externalTypes) {
    const resolver = getResolver(type);
    if (resolver) {
      const available = await resolver.checkAvailable();
      if (!available) {
        issues.push({
          severity: "warning",
          message: `${resolver.cliName} is not installed. Entries with type "${type}" will fail to resolve at execution time.`,
        });
      }
    }
  }

  // Check secrets
  if (envFile.secrets) {
    validateSecretEntries(
      Object.entries(envFile.secrets),
      "Secret ",
      issues,
      envFile.secret_providers,
    );
  }

  // Check proxy configuration
  if (envFile.proxy) {
    const proxyEntries: [string, SecretEntry][] = [];
    if (envFile.proxy.username) {
      proxyEntries.push(["username", envFile.proxy.username]);
    }
    if (envFile.proxy.password) {
      proxyEntries.push(["password", envFile.proxy.password]);
    }
    validateSecretEntries(proxyEntries, "Proxy ", issues, envFile.secret_providers);

    for (const [field, label] of [
      ["ca_cert_path", "CA certificate"],
      ["proxy_ca_cert_path", "Proxy CA certificate"],
    ] as const) {
      const certPath = envFile.proxy[field];
      if (certPath) {
        try {
          await access(certPath);
        } catch {
          issues.push({
            severity: "warning",
            message: `${label} file not found: ${certPath}`,
          });
        }
      }
    }
  }

  // Check env var references in variables
  if (envFile.variables) {
    for (const [key, value] of Object.entries(envFile.variables)) {
      const refs = extractEnvVarReferences(value);
      for (const ref of refs) {
        if (process.env[ref.name] === undefined && !ref.hasDefault) {
          issues.push({
            severity: "warning",
            message: `Variable "${key}": environment variable "${ref.name}" is not set and has no default value`,
          });
        }
      }
    }
  }

  // Check env var references in proxy server/bypass
  if (envFile.proxy) {
    for (const ref of extractEnvVarReferences(envFile.proxy.server)) {
      if (process.env[ref.name] === undefined && !ref.hasDefault) {
        issues.push({
          severity: "warning",
          message: `Proxy server: environment variable "${ref.name}" is not set and has no default value`,
        });
      }
    }
    if (envFile.proxy.bypass) {
      for (const ref of extractEnvVarReferences(envFile.proxy.bypass)) {
        if (process.env[ref.name] === undefined && !ref.hasDefault) {
          issues.push({
            severity: "warning",
            message: `Proxy bypass: environment variable "${ref.name}" is not set and has no default value`,
          });
        }
      }
    }
  }

  // Check for variable/secret key conflicts
  if (envFile.variables && envFile.secrets) {
    for (const key of Object.keys(envFile.secrets)) {
      if (key in envFile.variables) {
        issues.push({
          severity: "warning",
          message: `Key "${key}" is defined in both variables and secrets (secrets takes precedence)`,
        });
      }
    }
  }

  return {
    valid: issues.every((i) => i.severity !== "error"),
    filePath,
    variableKeys: Object.keys(envFile.variables ?? {}),
    secretKeys: Object.keys(envFile.secrets ?? {}),
    issues,
  };
}

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  filePath: string;
  variableKeys?: string[];
  secretKeys?: string[];
  issues: ValidationIssue[];
}

/**
 * Save an environment file to `.aqua/environments/{envName}.json`.
 * Creates the directory if it doesn't exist.
 */
export async function saveEnvironment(
  envName: string,
  envFile: EnvironmentFile
): Promise<string> {
  const projectRoot = getProjectRoot();
  const filePath = join(projectRoot, ".aqua", "environments", `${envName}.json`);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(envFile, null, 2) + "\n", "utf-8");

  return filePath;
}
