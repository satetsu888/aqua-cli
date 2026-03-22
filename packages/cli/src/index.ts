import { Command } from "commander";
import { startMCPServer } from "./mcp/server.js";
import {
  loadConfig,
  resolveServerURL,
  DEFAULT_SERVER_URL,
} from "./config/index.js";
import { getCredential, resolveCredential, removeCredential } from "./config/credentials.js";
import { runLogin } from "./setup/login.js";
import { runInit } from "./setup/init.js";
import { runExecute } from "./commands/execute.js";
import { runRecord } from "./commands/record.js";
import { AquaClient } from "./api/client.js";

declare const __CLI_VERSION__: string;

const program = new Command();

program
  .name("aqua-cli")
  .description("QA planning and execution service")
  .version(__CLI_VERSION__);

program
  .command("login")
  .description("Authenticate with the aqua server")
  .option("--server-url <url>", "Backend server URL", DEFAULT_SERVER_URL)
  .option("--force", "Re-authenticate even if credentials exist")
  .action(
    async (opts: { serverUrl: string; force?: boolean }) => {
      await runLogin(opts);
    }
  );

program
  .command("logout")
  .description("Remove saved credentials for the server")
  .action(async () => {
    const url = resolveServerURL();
    const existing = getCredential(url);
    if (!existing) {
      console.log(`Not logged in to ${url}`);
      return;
    }
    removeCredential(url);
    console.log(`Logged out from ${url}`);
  });

program
  .command("init")
  .description(
    "Initialize project configuration: select organization and project"
  )
  .option("--server-url <url>", "Backend server URL", DEFAULT_SERVER_URL)
  .action(async (opts: { serverUrl: string }) => {
    await runInit(opts);
  });

program
  .command("whoami")
  .description("Show the currently authenticated user")
  .action(async () => {
    const url = resolveServerURL();
    const credential = resolveCredential(url);
    if (!credential) {
      console.error("Not logged in. Run `aqua-cli login` first or set AQUA_API_KEY environment variable.");
      process.exit(1);
    }

    const client = new AquaClient(url, credential.api_key);
    try {
      const user = await client.getMe();
      console.log(`Logged in to ${url}`);
      console.log(`  User ID:      ${user.id}`);
      console.log(`  Email:        ${user.email || "(none)"}`);
      console.log(`  Display Name: ${user.display_name || "(none)"}`);
    } catch (err) {
      console.error(
        `Failed to get user info: ${(err as Error).message}`
      );
      process.exit(1);
    }
  });

function collectVars(
  value: string,
  previous: Record<string, string>
): Record<string, string> {
  const [key, ...rest] = value.split("=");
  if (!key || rest.length === 0) {
    console.error(`Error: Invalid --var format "${value}". Expected key=value`);
    process.exit(1);
  }
  return { ...previous, [key]: rest.join("=") };
}

program
  .command("execute <qa_plan_id>")
  .description("Execute a QA plan and report results")
  .option("--env <name>", "Environment name (.aqua/environments/<name>.json)")
  .option(
    "--plan-version <n>",
    "Version number to execute (defaults to latest)",
    parseInt
  )
  .option(
    "--var <key=value>",
    "Variable override (repeatable)",
    collectVars,
    {}
  )
  .action(
    async (
      qaPlanId: string,
      opts: {
        env?: string;
        planVersion?: number;
        var?: Record<string, string>;
      }
    ) => {
      await runExecute(qaPlanId, opts);
    }
  );

program
  .command("record [url]")
  .description(
    "Record browser actions using Playwright codegen. Opens a browser for you to operate; outputs BrowserStep[] JSON to stdout when you close the browser."
  )
  .action(async (url?: string) => {
    await runRecord(url);
  });

program
  .command("web")
  .description("Open the web UI in your browser (requires login)")
  .action(async () => {
    const url = resolveServerURL();
    const credential = resolveCredential(url);
    if (!credential) {
      console.error(
        "Not logged in. Run `aqua-cli login` first or set AQUA_API_KEY environment variable."
      );
      process.exit(1);
    }

    const client = new AquaClient(url, credential.api_key);
    try {
      const { browser_url: browserURL } = await client.createExchangeToken();
      console.log(`Opening web UI...`);
      console.log(`  ${browserURL}\n`);

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
        console.log("Could not open browser automatically. Please open the URL above.");
      }
    } catch (err) {
      console.error(`Failed to create exchange token: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("mcp-server")
  .description("Start the MCP server for AI agent integration")
  .action(async () => {
    const serverURL = resolveServerURL();
    const credential = resolveCredential(serverURL);
    const config = loadConfig();
    await startMCPServer(serverURL, credential?.api_key, config);
  });

program.parse();
