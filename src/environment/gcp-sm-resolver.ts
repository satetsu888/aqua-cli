import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretEntry } from "./types.js";
import type { ExternalSecretResolver, ProviderConfig } from "./resolver-registry.js";

const execFileAsync = promisify(execFile);

async function checkGcloudAvailable(): Promise<boolean> {
  try {
    await execFileAsync("gcloud", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function extractJsonKey(raw: string, jsonKey: string, reference: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `GCP Secret Manager secret "${reference}" value is not valid JSON, but json_key "${jsonKey}" was specified`
    );
  }
  if (typeof parsed !== "object" || parsed === null || !(jsonKey in parsed)) {
    throw new Error(
      `GCP Secret Manager secret "${reference}" does not contain key "${jsonKey}"`
    );
  }
  return String((parsed as Record<string, unknown>)[jsonKey]);
}

async function readGcpSmSecret(
  secretName: string,
  project?: string,
  version?: string,
  jsonKey?: string,
  providerConfig?: ProviderConfig,
): Promise<string> {
  const ver = version ?? "latest";
  const args = [
    "secrets",
    "versions",
    "access",
    ver,
    `--secret=${secretName}`,
  ];
  // Entry-level project overrides provider-level project
  const effectiveProject = project ?? providerConfig?.project;
  if (effectiveProject) {
    args.push(`--project=${effectiveProject}`);
  }

  try {
    const { stdout } = await execFileAsync("gcloud", args);
    const value = stdout.trimEnd();
    if (jsonKey) {
      return extractJsonKey(value, jsonKey, secretName);
    }
    return value;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (
      message.includes("not authenticated") ||
      message.includes("UNAUTHENTICATED") ||
      message.includes("login")
    ) {
      throw new Error(
        `Google Cloud SDK is not authenticated. Run "gcloud auth login".\n` +
          `(secret: ${secretName})`
      );
    }

    if (message.includes("NOT_FOUND")) {
      throw new Error(
        `GCP Secret Manager secret not found: ${secretName}${project ? ` (project: ${project})` : ""}`
      );
    }

    throw new Error(
      `Failed to read secret from GCP Secret Manager: ${secretName}\n${message}`
    );
  }
}

export const gcpSmResolver: ExternalSecretResolver = {
  type: "gcp_sm",
  cliName: "Google Cloud SDK (gcloud)",
  installUrl: "https://cloud.google.com/sdk/docs/install",
  checkAvailable: checkGcloudAvailable,
  async resolve(entry: SecretEntry, _context: string, providerConfig?: ProviderConfig) {
    const e = entry as Extract<SecretEntry, { type: "gcp_sm" }>;
    return readGcpSmSecret(e.value, e.project, e.version, e.json_key, providerConfig);
  },
  validate(entry: SecretEntry) {
    // No specific format validation needed for gcp_sm
    return [];
  },
};
