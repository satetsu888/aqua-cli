import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AquaClient } from "../api/client.js";
import { AquaConfig } from "../config/index.js";
import { ensureCredential } from "../setup/login.js";
import { registerQAPlanTools } from "./tools/qa-plan.js";
import { registerExecutionTools } from "./tools/execution.js";
import { registerEnvironmentTools } from "./tools/environment.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerScenarioTools } from "./tools/scenario.js";
import { registerCommonScenarioTools } from "./tools/common-scenario.js";
import { registerSetupTools } from "./tools/setup.js";
import { registerRecorderTools } from "./tools/recorder.js";
import { registerProgressTools } from "./tools/progress.js";
import { registerExplorationTools } from "./tools/exploration.js";
import { registerExplorationLogTools } from "./tools/exploration-log.js";
import { cleanupAllExplorationLogs } from "../exploration/log.js";
import { warmSecretCache } from "../environment/index.js";
import { PluginRegistry, loadPlugins } from "../plugin/index.js";

declare const __CLI_VERSION__: string;

export async function startMCPServer(
  serverURL: string,
  apiKey?: string | null,
  config?: AquaConfig | null
): Promise<void> {
  // Ensure we have credentials (error if not logged in)
  let effectiveApiKey = apiKey;
  if (!effectiveApiKey) {
    const credential = ensureCredential(serverURL);
    effectiveApiKey = credential.api_key;
  }

  const projectKey = config?.project_key;
  const client = new AquaClient(serverURL, effectiveApiKey, projectKey);

  // Verify authentication (and project access if project key is configured)
  try {
    if (projectKey) {
      // Resolve project by key (auto-creates if needed, auto-merges if applicable)
      const result = await client.resolveProject();
      if (result.created) {
        process.stderr.write(
          `Project auto-created for key '${projectKey}' in your personal organization.\n`
        );
      }
    } else {
      await client.listOrganizations();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("401")) {
      process.stderr.write(
        `Error: Authentication failed. Your credentials may be expired or invalid.\n` +
          `Run 'aqua-cli logout' then 'aqua-cli login' to re-authenticate.\n`
      );
      process.exit(1);
    }
    throw err;
  }

  // Pre-resolve external secrets from environment files
  try {
    const cacheResult = await warmSecretCache();
    if (cacheResult.resolved > 0) {
      process.stderr.write(
        `Pre-resolved ${cacheResult.resolved} secret(s) from environment files.\n`
      );
    }
    if (cacheResult.failed > 0) {
      process.stderr.write(
        `Warning: ${cacheResult.failed} secret(s) could not be pre-resolved (will retry at execution time).\n`
      );
    }
  } catch {
    // Secret cache warmup failure should not block MCP startup
  }

  // Load plugins from .aqua/config.json
  const pluginRegistry = new PluginRegistry();
  try {
    await loadPlugins(pluginRegistry);
    for (const plugin of pluginRegistry.getAllPlugins()) {
      process.stderr.write(`Plugin loaded: ${plugin.name} (action: ${plugin.actionType})\n`);
    }
  } catch {
    // Plugin loading failure should not block MCP startup
  }

  const pluginActionDescriptions = pluginRegistry.getActionDescriptions();

  const server = new McpServer(
    {
      name: "aqua",
      version: __CLI_VERSION__,
    },
    {
      instructions: `aqua is a QA planning and execution service for AI agents.

## Setup

If .aqua/config.json does not exist in the project directory, run the following command to initialize:
  npx @aquaqa/cli init --server-url <server_url>

## Typical Workflow

### Step 1: Check Project Setup
Call check_project_setup to see the current state of the project.
This checks project memory, environments, and common scenarios in one call.
Follow any recommendations (e.g. create an environment if none exists).

### Step 2: Create a QA Plan
1. create_qa_plan - Create a new QA plan
2. update_qa_plan - Add scenarios and steps (a plan cannot be executed without this)

If project memory has content, review it with get_project_memory for useful context (app architecture, auth flows, known selectors, etc.).
Use list_common_scenarios to check for reusable scenario templates.

A QA Plan requires at least one version (created via update_qa_plan) before it can be executed. Each call to update_qa_plan, update_qa_plan_step, add_qa_plan_step, or remove_qa_plan_step creates a new immutable version.

### Step 3: Execute
execute_qa_plan - Execute the plan and get results.
Pass env_name to select the target environment.
For long-running plans, use async=true to start execution in the background, then poll with get_execution_progress.

### Step 4: Analyze and Learn
Review execution results. If failures occur:
- Analyze the root cause from step execution details
- Report findings to the user and discuss next steps
- Do NOT silently adjust the QA plan to make it pass

Save any new insights learned during this process (effective selectors, timing quirks, auth flow details, app behavior) to project memory with save_project_memory.
If you notice repeated scenarios (e.g. login), consider creating common scenarios with create_common_scenario.

### Step 5: Iterate
Based on results, refine the QA plan:
- update_qa_plan_step to fix individual steps
- add_qa_plan_step / remove_qa_plan_step for structural changes
- Re-execute with execute_qa_plan

Each update creates a new immutable version; previous versions are preserved.

## Environment Configuration

If the target application requires specific URLs, API keys, or other configuration:
1. Use list_environments to check for existing environment configurations
2. Use create_environment to create a new environment file (.aqua/environments/{name}.json)
3. Pass env_name parameter to execute_qa_plan to use the environment

## Variable Templates

Use {{variable_name}} syntax in URLs, headers, and other string fields. Variables are resolved from three sources (in order of priority, lowest to highest):
1. Plan variables (defined in update_qa_plan)
2. Environment file (loaded via env_name in execute_qa_plan)
3. Execution overrides (passed as environment parameter in execute_qa_plan)

Special template syntax:
- {{totp:variable_name}} - Computes a 6-digit TOTP one-time password from the variable value. The value must be a Base32-encoded TOTP secret (e.g. "JBSWY3DPEBLW64TMMQQQ") or an otpauth:// URI. Use this for automating 2FA login flows.

## Secrets

Environment files support three secret resolution types:
- literal: Use the value directly
- env: Read from an OS environment variable at execution time
- op: Read from 1Password CLI at execution time (value is an op:// secret reference URI, e.g. "op://vault/item/password"). Requires 1Password CLI installed and signed in.

## Proxy

Environment files can include a proxy section to route HTTP requests and browser access through a proxy server. Configure server (proxy URL), bypass (comma-separated domains to skip), and optional username/password (using secret entry format). The proxy applies to both HTTP Driver (via undici ProxyAgent) and Browser Driver (via Playwright proxy option).

## Interactive Exploration with start_exploration

When you DON'T know the page structure, CSS selectors, or API response formats yet, use the exploration session to investigate interactively:

1. start_exploration - Create an exploration session (optionally load environment variables)
2. explore_action - Execute one action at a time (browser step, HTTP request, or browser assertion) and inspect the result
3. end_exploration - Close the session when done

Each browser action returns the full page DOM HTML (for discovering selectors), a screenshot, the current URL, and the page title. The browser stays alive between actions so you can build up state incrementally (navigate → click → type → inspect).

Use exploration when you need to:
- Discover which CSS selectors work for target elements
- Understand page structure before writing scenarios
- Inspect API response formats and values
- Iteratively test actions with immediate feedback

### Replaying Previous Explorations

Exploration sessions are automatically logged to disk. Use list_exploration_logs to see recent sessions and get_exploration_log to retrieve the action sequence from a previous session. To quickly replay a known sequence (e.g., login flow discovered in a previous session), pass the actions to explore_action's browser_steps parameter — this executes them all at once without returning intermediate DOM/screenshots, saving context.

## Quick Testing with run_scenario

When you ALREADY have a complete scenario definition and want to validate it works in a single call, use run_scenario.
This executes all steps at once and returns structured pass/fail results — ideal for batch validation after you know the selectors and page flow.
You can pass qa_plan_id to inherit the plan's default variables.

Typical workflow: start_exploration (discover) → run_scenario (validate) → update_qa_plan (finalize)

## Browser Recording

Use record_browser_actions to open a real browser and record user actions.
The user operates the browser; when they close it, the recorded actions are returned as BrowserStep[].
This is useful when complex UI interactions are hard to describe — let the user demonstrate the workflow and capture the exact selectors and action sequence.
Input field values (fill actions) are automatically replaced with {{variable_name}} template variables — the original typed values are not included. The variable names are derived from the field's label, placeholder, or id. You need to map these variable names to actual values in an environment configuration or as execution parameters.
Use the returned steps with update_qa_plan, create_common_scenario, or run_scenario.

## Common Scenarios

Reusable scenario templates stored at the project level. Use list_common_scenarios to see available templates, and reference them in update_qa_plan scenarios via common_scenario_id. Common scenarios are snapshot-copied into QA plans (not linked by reference), so changes to a common scenario do not affect existing plans.

## Project Memory

Each project can store a memory document for accumulating project knowledge learned through QA plan creation and execution — app architecture, authentication flows, effective UI selectors, and lessons learned. Use get_project_memory to review existing knowledge before creating QA plans. After executing plans, save any new insights with save_project_memory.` +
      (pluginActionDescriptions
        ? `\n\n## Plugin Actions\n\nThe following plugin action types are available in addition to the built-in http_request and browser actions:\n${pluginActionDescriptions}`
        : ""),
    }
  );

  registerQAPlanTools(server, client, pluginRegistry);
  registerExecutionTools(server, client, pluginRegistry);
  registerScenarioTools(server, client, pluginRegistry);
  registerCommonScenarioTools(server, client, pluginRegistry);
  registerEnvironmentTools(server);
  registerSetupTools(server, client, config);
  registerMemoryTools(server, client);
  registerRecorderTools(server);
  registerProgressTools(server, client);
  registerExplorationTools(server, client, projectKey);
  registerExplorationLogTools(server, projectKey);

  // Cleanup old exploration logs (best-effort, non-blocking)
  try {
    cleanupAllExplorationLogs();
  } catch {
    // ignore
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
