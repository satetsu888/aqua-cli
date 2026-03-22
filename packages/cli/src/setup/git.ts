import { execSync } from "node:child_process";

export interface GitRemoteInfo {
  rawURL: string;
  ownerRepo: string;
}

export function detectGitRemote(): GitRemoteInfo | null {
  try {
    const rawURL = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!rawURL) return null;
    const ownerRepo = normalizeGitURL(rawURL);
    if (!ownerRepo) return null;
    return { rawURL, ownerRepo };
  } catch {
    return null;
  }
}

/**
 * Normalize a git remote URL to "owner/repo" format.
 *
 * Handles:
 *   git@github.com:owner/repo.git → owner/repo
 *   https://github.com/owner/repo.git → owner/repo
 *   ssh://git@github.com/owner/repo.git → owner/repo
 */
function normalizeGitURL(url: string): string | null {
  // SSH format: git@host:owner/repo.git
  const sshMatch = url.match(/^[^@]+@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS / SSH-URL format: https://host/owner/repo.git
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
    if (path) return path;
  } catch {
    // not a valid URL
  }

  return null;
}

/**
 * Normalize a repository URL into a project key (host/path form).
 *
 * Strips protocol, authentication, and .git suffix:
 *   git@github.com:user/repo.git     → github.com/user/repo
 *   https://github.com/user/repo.git → github.com/user/repo
 *   ssh://git@github.com/user/repo   → github.com/user/repo
 */
export function normalizeProjectKey(repoURL: string): string {
  const raw = repoURL.trim();
  if (!raw) return "";

  let host = "";
  let path = "";

  // SCP-style: git@github.com:user/repo.git
  if (!raw.includes("://")) {
    const atIdx = raw.indexOf("@");
    if (atIdx >= 0) {
      const rest = raw.substring(atIdx + 1);
      const colonIdx = rest.indexOf(":");
      if (colonIdx >= 0) {
        host = rest.substring(0, colonIdx);
        path = rest.substring(colonIdx + 1);
      }
    }
  }

  // URL-style: https://github.com/user/repo.git, ssh://git@github.com/user/repo
  if (!host) {
    try {
      const parsed = new URL(raw);
      host = parsed.hostname;
      path = parsed.pathname.replace(/^\//, "");
    } catch {
      return raw;
    }
  }

  // Clean up
  path = path.replace(/\.git$/, "").replace(/\/+$/, "");
  host = host.toLowerCase();

  if (!host || !path) return raw;

  return `${host}/${path}`;
}

/**
 * Generate a project key for a repository without a git remote.
 * Uses the directory basename + random suffix.
 */
export function generateLocalProjectKey(dirName: string): string {
  const suffix = Math.random().toString(36).substring(2, 10);
  return `local/${dirName}-${suffix}`;
}

export function detectCurrentBranch(): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function detectPullRequestURL(): string | null {
  try {
    const url = execSync("gh pr view --json url -q .url", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}
