import { AquaClient } from "../api/client.js";
import { QAPlanExecutor, type ExecutionSummary, type OnStepCompleteCallback } from "../driver/executor.js";
import { loadEnvironment, listEnvironments } from "../environment/index.js";
import { collectVariableReferences } from "../utils/template.js";
import { resolveCredential } from "../config/credentials.js";
import { loadConfig, resolveServerURL } from "../config/index.js";
import { promptSelect, closePrompts } from "../setup/prompts.js";
import type { QAPlanData, Scenario, Step } from "../qa-plan/types.js";

export interface ExecuteQAPlanOptions {
  qaPlanId: string;
  version?: number;
  envName?: string;
  vars?: Record<string, string>;
  onExecutionCreated?: (executionId: string, executionUrl: string) => void;
  onStepComplete?: OnStepCompleteCallback;
}

/**
 * Shared execution logic used by both CLI command and MCP tool.
 * Fetches plan data, loads environment, and runs the executor.
 */
export async function executeQAPlan(
  client: AquaClient,
  opts: ExecuteQAPlanOptions
): Promise<ExecutionSummary> {
  const { qaPlanId, version, envName, vars } = opts;

  // Get plan and version
  const plan = await client.getQAPlan(qaPlanId);
  if (!plan.latest_version && !version) {
    throw new Error(
      "Plan has no versions. Create a version first with update_qa_plan."
    );
  }

  let planVersion;
  if (version) {
    planVersion = await client.getQAPlanVersion(qaPlanId, version);
  } else {
    planVersion = plan.latest_version!;
  }

  // Fetch structured scenarios from API
  const scenarioResponses = await client.getVersionScenarios(
    qaPlanId,
    planVersion.version
  );

  // Convert API response to QAPlanData
  const planData: QAPlanData = {
    name: planVersion.name,
    description: planVersion.description,
    variables: planVersion.variables,
    scenarios: scenarioResponses.map(
      (sc): Scenario => ({
        id: sc.id,
        name: sc.name,
        requires: sc.requires,
        sort_order: sc.sort_order,
        steps: sc.steps.map(
          (st): Step => ({
            id: st.id,
            step_key: st.step_key,
            action: st.action as Step["action"],
            config: st.config as unknown as Step["config"],
            assertions: st.assertions as Step["assertions"],
            extract: st.extract,
            depends_on: st.depends_on,
            sort_order: st.sort_order,
          })
        ),
      })
    ),
  };

  // Collect variable references from the plan to resolve only needed secrets
  const requiredKeys = collectVariableReferences(planData);

  // Load environment file if env_name is specified
  let resolvedEnv;
  if (envName) {
    resolvedEnv = await loadEnvironment(envName, requiredKeys);
  }

  // Pre-check quota status to determine if recording should be skipped
  let skipRecording = false;
  try {
    const quotaStatus = await client.getQuotaStatus();
    if (quotaStatus.storage.exceeded) {
      skipRecording = true;
      process.stderr.write(
        "\nWarning: Quota exceeded. Test results will not be saved to the server.\n\n"
      );
    }
  } catch {
    // Pre-check failure is non-critical; fall back to normal recording.
    // The server's 402 enforcement acts as a safety net.
  }

  // Execute
  const executor = new QAPlanExecutor(client);
  return executor.execute(planData, planVersion.id, vars, resolvedEnv, envName, opts.onExecutionCreated, opts.onStepComplete, skipRecording);
}

// --- CLI command handler ---

interface RunExecuteOptions {
  env?: string;
  planVersion?: number;
  var?: Record<string, string>;
}

export async function runExecute(
  qaPlanId: string,
  opts: RunExecuteOptions
): Promise<void> {
  const serverUrl = resolveServerURL();
  const credential = resolveCredential(serverUrl);
  if (!credential) {
    console.error("Not logged in. Run `aqua-cli login` first or set AQUA_API_KEY environment variable.");
    process.exit(1);
  }

  const config = loadConfig();
  const client = new AquaClient(
    serverUrl,
    credential.api_key,
    config?.project_key
  );

  // Resolve environment name
  let envName = opts.env;
  if (!envName) {
    const envs = await listEnvironments();
    if (envs.length === 1) {
      envName = envs[0].name;
      console.log(`Using environment: ${envName}`);
    } else if (envs.length > 1) {
      const { value } = await promptSelect(
        "Select environment:",
        envs.map((e) => ({
          label: e.notes ? `${e.name} — ${e.notes}` : e.name,
          name: e.name,
        }))
      );
      envName = (value as { label: string; name: string }).name;
      closePrompts();
    }
  }

  console.log(`Executing QA plan ${qaPlanId}...`);

  try {
    const summary = await executeQAPlan(client, {
      qaPlanId,
      version: opts.planVersion,
      envName,
      vars: opts.var,
      onExecutionCreated: (_id, url) => {
        console.log(`URL: ${url}`);
      },
    });
    printResult(summary);
    process.exit(summary.status === "completed" ? 0 : 1);
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}

// ANSI color helpers
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function printResult(summary: ExecutionSummary): void {
  console.log("");

  let currentScenario = "";
  for (const result of summary.results) {
    if (result.scenarioName !== currentScenario) {
      currentScenario = result.scenarioName;
      console.log(`  ${currentScenario}`);
    }

    const icon =
      result.status === "passed"
        ? green("✓")
        : result.status === "failed"
          ? red("✗")
          : result.status === "error"
            ? red("!")
            : dim("-");
    console.log(`    ${icon} ${result.stepKey}`);

    if (result.errorMessage) {
      console.log(`      ${dim(result.errorMessage)}`);
    }
  }

  console.log("");

  const statusText =
    summary.status === "completed"
      ? green("completed")
      : summary.status === "failed"
        ? red("failed")
        : red("error");
  console.log(`Status: ${statusText}`);

  // Build steps summary with colors only for non-zero failure/error/skip counts
  const parts = [
    `${summary.totalSteps} total`,
    green(`${summary.passed} passed`),
    summary.failed > 0
      ? red(`${summary.failed} failed`)
      : dim(`${summary.failed} failed`),
    summary.errors > 0
      ? red(`${summary.errors} errors`)
      : dim(`${summary.errors} errors`),
    summary.skipped > 0
      ? yellow(`${summary.skipped} skipped`)
      : dim(`${summary.skipped} skipped`),
  ];
  console.log(`Steps: ${parts.join(", ")}`);

  if (!summary.recorded) {
    console.log("");
    console.log(yellow("Warning: Results were not saved to the server (quota exceeded)."));
  }
}
