import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretEntry } from "./types.js";
import type { ExternalSecretResolver, ProviderConfig } from "./resolver-registry.js";

const execFileAsync = promisify(execFile);

async function checkAwsCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("aws", ["--version"]);
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
      `AWS Secrets Manager secret "${reference}" value is not valid JSON, but json_key "${jsonKey}" was specified`
    );
  }
  if (typeof parsed !== "object" || parsed === null || !(jsonKey in parsed)) {
    throw new Error(
      `AWS Secrets Manager secret "${reference}" does not contain key "${jsonKey}"`
    );
  }
  return String((parsed as Record<string, unknown>)[jsonKey]);
}

async function readAwsSmSecret(
  secretId: string,
  region?: string,
  jsonKey?: string,
  providerConfig?: ProviderConfig,
): Promise<string> {
  const args = [
    "secretsmanager",
    "get-secret-value",
    "--secret-id",
    secretId,
    "--query",
    "SecretString",
    "--output",
    "text",
  ];
  // Entry-level region overrides provider-level region
  const effectiveRegion = region ?? providerConfig?.region;
  if (effectiveRegion) {
    args.push("--region", effectiveRegion);
  }
  if (providerConfig?.profile) {
    args.push("--profile", providerConfig.profile);
  }

  try {
    const { stdout } = await execFileAsync("aws", args);
    const value = stdout.trimEnd();
    if (jsonKey) {
      return extractJsonKey(value, jsonKey, secretId);
    }
    return value;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (
      message.includes("Unable to locate credentials") ||
      message.includes("ExpiredToken")
    ) {
      throw new Error(
        `AWS CLI is not authenticated. Run "aws configure" or "aws sso login".\n` +
          `(secret: ${secretId})`
      );
    }

    if (message.includes("ResourceNotFoundException")) {
      throw new Error(
        `AWS Secrets Manager secret not found: ${secretId}${region ? ` (region: ${region})` : ""}`
      );
    }

    throw new Error(
      `Failed to read secret from AWS Secrets Manager: ${secretId}\n${message}`
    );
  }
}

export const awsSmResolver: ExternalSecretResolver = {
  type: "aws_sm",
  cliName: "AWS CLI (aws)",
  installUrl: "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
  checkAvailable: checkAwsCliAvailable,
  async resolve(entry: SecretEntry, _context: string, providerConfig?: ProviderConfig) {
    const e = entry as Extract<SecretEntry, { type: "aws_sm" }>;
    return readAwsSmSecret(e.value, e.region, e.json_key, providerConfig);
  },
  validate(entry: SecretEntry) {
    // No specific format validation needed for aws_sm
    return [];
  },
};
