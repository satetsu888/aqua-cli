import { execSync } from "node:child_process";

/**
 * Get the project root directory.
 * Uses `git rev-parse --show-toplevel` to find the git repository root.
 * Falls back to process.cwd() if not in a git repository.
 */
export function getProjectRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return process.cwd();
  }
}
