import { AquaClient } from "../api/client.js";
import { AquaConfig, saveConfig } from "../config/index.js";
import { ensureCredential } from "./login.js";
import { detectGitRemote, normalizeProjectKey, generateLocalProjectKey } from "./git.js";
import { closePrompts } from "./prompts.js";
import { basename } from "node:path";
import { getProjectRoot } from "../config/projectRoot.js";

interface InitOptions {
  serverUrl: string;
}

export async function runInit(opts: InitOptions): Promise<void> {
  try {
    const url = opts.serverUrl;

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      console.error("Error: URL must start with http:// or https://");
      process.exit(1);
    }

    // Get existing credential or error if not logged in
    let credential;
    try {
      credential = ensureCredential(url);
    } catch {
      console.error("Not logged in. Run `aqua-cli login` first.");
      process.exit(1);
    }

    const client = new AquaClient(url, credential.api_key);

    // Verify authentication
    try {
      await client.listOrganizations();
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        console.error(
          `\nError: Authentication failed. Your credentials may be expired or invalid.\n` +
            `Run 'aqua-cli logout' then 'aqua-cli login' to re-authenticate.\n`
        );
        process.exit(1);
      }
      throw err;
    }

    // Generate project_key from git remote
    const gitRemote = detectGitRemote();
    let projectKey: string;
    if (gitRemote) {
      projectKey = normalizeProjectKey(gitRemote.rawURL);
      console.log(`\nDetected git remote: ${gitRemote.rawURL}`);
      console.log(`Project key: ${projectKey}`);
    } else {
      const dirName = basename(getProjectRoot());
      projectKey = generateLocalProjectKey(dirName);
      console.log(`\nNo git remote found. Generated local project key: ${projectKey}`);
    }

    // Save config
    const config: AquaConfig = {
      server_url: url,
      project_key: projectKey,
    };
    saveConfig(config);

    console.log(`\nConfiguration saved to .aqua/config.json`);
    console.log(`  server_url:  ${url}`);
    console.log(`  project_key: ${projectKey}`);

    // Register project on server
    const projectClient = new AquaClient(url, credential.api_key, projectKey);
    try {
      const result = await projectClient.resolveProject();
      if (result.created) {
        console.log(`\nProject registered on server (newly created).`);
      } else {
        console.log(`\nProject resolved on server (already exists).`);
      }
      console.log(`  Project ID:   ${result.project.id}`);
      console.log(`  Project name: ${result.project.name}`);
    } catch (err) {
      console.error(
        `\nWarning: Failed to register project on server. It will be auto-created when the MCP server starts.`
      );
      if (err instanceof Error) {
        console.error(`  ${err.message}`);
      }
    }
  } finally {
    closePrompts();
  }
}
