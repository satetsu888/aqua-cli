import pc from "picocolors";
import {
  getCredential,
  resolveCredential,
  setCredential,
  ServerCredential,
} from "../config/credentials.js";

interface LoginOptions {
  serverUrl: string;
  force?: boolean;
}

export async function runLogin(opts: LoginOptions): Promise<void> {
  const url = opts.serverUrl;

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    console.error("Error: URL must start with http:// or https://");
    process.exit(1);
  }

  const credential = await authenticate(url, opts);

  console.log();
  console.log(pc.cyan("  ┌───────────────────────────────┐"));
  console.log(pc.cyan("  │                               │"));
  console.log(pc.cyan("  │") + pc.bold(pc.cyan("   ~~ aqua ~~")) + pc.cyan("                  │"));
  console.log(pc.cyan("  │") + "   Let's get started!" + pc.cyan("          │"));
  console.log(pc.cyan("  │                               │"));
  console.log(pc.cyan("  └───────────────────────────────┘"));
  console.log();
  console.log(pc.dim(`  Credentials saved to ~/.aqua/credentials.json`));
  console.log(pc.dim(`    server:  ${url}`));
  console.log(pc.dim(`    api_key: ${credential.api_key.substring(0, 12)}...`));
  console.log(`\n  Next: Run ${pc.bold("aqua-cli init")} to set up a project.`);
}

/**
 * Returns existing credential or throws an error if not logged in.
 * Checks AQUA_API_KEY environment variable first, then credentials file.
 */
export function ensureCredential(
  url: string
): ServerCredential {
  const existing = resolveCredential(url);
  if (existing) {
    return existing;
  }

  throw new Error(
    "Not logged in. Run 'aqua-cli login' first or set AQUA_API_KEY environment variable."
  );
}

async function authenticate(
  url: string,
  opts: LoginOptions
): Promise<ServerCredential> {
  const existing = getCredential(url);
  if (existing && !opts.force) {
    console.log(`Already authenticated with ${url}`);
    console.log(`  api_key: ${existing.api_key.substring(0, 12)}...`);
    console.log(`Use --force to re-authenticate.`);
    return existing;
  }

  return await browserAuth(url);
}

async function browserAuth(url: string): Promise<ServerCredential> {
  console.log(`Initiating login with ${url}...`);

  const initRes = await fetch(`${url}/auth/cli-login`, { method: "POST" });
  if (!initRes.ok) {
    const err = await initRes
      .json()
      .catch(() => ({ error: initRes.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }
  const { token, browser_url: browserURL } = (await initRes.json()) as {
    token: string;
    browser_url: string;
  };
  console.log(`\nOpen this URL in your browser to authenticate:`);
  console.log(`  ${browserURL}\n`);

  // Try to open browser automatically
  try {
    const { exec } = await import("node:child_process");
    const openCmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    const child = exec(`${openCmd} "${browserURL}"`);
    child.unref();
  } catch {
    // Ignore - user can open manually
  }

  console.log("Waiting for authentication...");

  const pollURL = `${url}/auth/cli-login/${token}/poll`;
  const maxAttempts = 100;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const pollRes = await fetch(pollURL);
    if (!pollRes.ok) {
      if (pollRes.status === 410) {
        console.error("Login request expired. Please try again.");
        process.exit(1);
      }
      continue;
    }

    const poll = (await pollRes.json()) as {
      status: string;
      user?: { id: string; email: string };
      api_key?: string;
    };

    if (poll.status === "completed" && poll.api_key && poll.user) {
      const credential: ServerCredential = {
        api_key: poll.api_key,
        user_id: poll.user.id,
      };
      setCredential(url, credential);

      console.log(`\nAuthenticated successfully!`);
      console.log(`  email: ${poll.user.email}`);
      return credential;
    }
  }

  console.error("Login timed out. Please try again.");
  process.exit(1);
}
