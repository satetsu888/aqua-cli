import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretEntry } from "./types.js";
import type { ExternalSecretResolver, ProviderConfig } from "./resolver-registry.js";

const execFileAsync = promisify(execFile);

async function checkVaultAvailable(): Promise<boolean> {
  try {
    await execFileAsync("vault", ["version"]);
    return true;
  } catch {
    return false;
  }
}

async function readVaultSecret(
  path: string,
  field?: string,
  mount?: string,
  providerConfig?: ProviderConfig,
): Promise<string> {
  const mountPoint = mount ?? "secret";
  const args: string[] = [];

  // -address flag if provided via secret_providers
  if (providerConfig?.address) {
    args.push(`-address=${providerConfig.address}`);
  }
  if (providerConfig?.namespace) {
    args.push(`-namespace=${providerConfig.namespace}`);
  }

  args.push("kv", "get", `-mount=${mountPoint}`);

  if (field) {
    args.push(`-field=${field}`);
  } else {
    args.push("-format=json");
  }
  args.push(path);

  try {
    const { stdout } = await execFileAsync("vault", args);
    const value = stdout.trimEnd();

    if (!field) {
      // Without -field, parse JSON and return the data object as a string
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return value;
      }
      // KV v2: data is at .data.data, KV v1: data is at .data
      const obj = parsed as Record<string, unknown>;
      const kvData = obj.data;
      if (typeof kvData === "object" && kvData !== null && "data" in kvData) {
        return JSON.stringify((kvData as Record<string, unknown>).data);
      }
      return JSON.stringify(kvData);
    }

    return value;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (
      message.includes("permission denied") ||
      message.includes("missing client token")
    ) {
      throw new Error(
        `HashiCorp Vault is not authenticated. Run "vault login" or set VAULT_TOKEN.\n` +
          `(path: ${mountPoint}/${path})`
      );
    }

    if (message.includes("no secrets")) {
      throw new Error(
        `HashiCorp Vault secret not found: ${mountPoint}/${path}${field ? ` (field: ${field})` : ""}`
      );
    }

    throw new Error(
      `Failed to read secret from HashiCorp Vault: ${mountPoint}/${path}\n${message}`
    );
  }
}

export const hcvResolver: ExternalSecretResolver = {
  type: "hcv",
  cliName: "HashiCorp Vault CLI (vault)",
  installUrl: "https://developer.hashicorp.com/vault/install",
  checkAvailable: checkVaultAvailable,
  async resolve(entry: SecretEntry, _context: string, providerConfig?: ProviderConfig) {
    const e = entry as Extract<SecretEntry, { type: "hcv" }>;
    return readVaultSecret(e.value, e.field, e.mount, providerConfig);
  },
  validate(_entry: SecretEntry, providerConfig?: ProviderConfig) {
    const issues: { severity: "error" | "warning"; message: string }[] = [];
    // Check if Vault address is configured either via secret_providers or VAULT_ADDR env var
    if (!providerConfig?.address && !process.env.VAULT_ADDR) {
      issues.push({
        severity: "warning",
        message:
          'Vault server address is not configured. Set "address" in secret_providers.hcv or the VAULT_ADDR environment variable.',
      });
    }
    return issues;
  },
};
