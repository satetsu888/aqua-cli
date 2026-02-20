import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExternalSecretResolver } from "./resolver-registry.js";

const execFileAsync = promisify(execFile);

/**
 * Check if the 1Password CLI (`op`) is available on PATH.
 */
export async function checkOpAvailable(): Promise<boolean> {
  try {
    await execFileAsync("op", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a secret value from 1Password using a secret reference URI.
 * @param reference - Secret reference (e.g. "op://vault/item/field")
 */
export async function readOpSecret(reference: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("op", [
      "read",
      reference,
      "--no-newline",
    ]);
    return stdout;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);

    if (message.includes("not currently signed in")) {
      throw new Error(
        `1Password CLI is not signed in. Run "op signin" or enable app integration in the 1Password desktop app.\n` +
          `(secret reference: ${reference})`
      );
    }

    throw new Error(
      `Failed to read secret from 1Password: ${reference}\n${message}`
    );
  }
}

export const opResolver: ExternalSecretResolver = {
  type: "op",
  cliName: "1Password CLI (op)",
  installUrl: "https://developer.1password.com/docs/cli/get-started/",
  checkAvailable: checkOpAvailable,
  async resolve(entry, _context) {
    return readOpSecret(entry.value);
  },
  validate(entry) {
    if (!entry.value.startsWith("op://")) {
      return [
        {
          severity: "warning",
          message: `value should start with "op://" (got "${entry.value}")`,
        },
      ];
    }
    return [];
  },
};
