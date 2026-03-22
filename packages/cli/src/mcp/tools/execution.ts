import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AquaClient } from "../../api/client.js";
import { executeQAPlan } from "../../commands/execute.js";
import type { ExecutionSummary, StepCompleteEvent } from "../../driver/executor.js";
function formatExecutionResult(
  planName: string,
  summary: ExecutionSummary
): string {
  const lines: string[] = [
    `# Execution Result: ${planName}`,
    ``,
    `**Execution ID:** ${summary.executionId}`,
    `**Status:** ${summary.status}`,
    `**Total Steps:** ${summary.totalSteps}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Errors: ${summary.errors}`,
    `- Skipped: ${summary.skipped}`,
    ``,
  ];

  // Variables section
  const varEntries = Object.entries(summary.resolvedVariables);
  if (varEntries.length > 0) {
    lines.push(`## Variables`);
    for (const [key, value] of varEntries) {
      lines.push(`- ${key}: ${value}`);
    }
    lines.push(``);
  }

  for (const result of summary.results) {
    const icon =
      result.status === "passed"
        ? "[PASS]"
        : result.status === "failed"
          ? "[FAIL]"
          : result.status === "error"
            ? "[ERROR]"
            : "[SKIP]";
    lines.push(`## ${icon} ${result.scenarioName} / ${result.stepKey}`);

    if (result.errorMessage) {
      lines.push(`Error: ${result.errorMessage}`);
    }

    if (result.response) {
      lines.push(
        `HTTP ${result.response.status} (${result.response.duration}ms)`
      );
    }

    if (result.assertionResults) {
      for (const ar of result.assertionResults) {
        const mark = ar.passed ? "PASS" : "FAIL";
        lines.push(
          `  [${mark}] ${ar.type}: expected=${ar.expected ?? "N/A"}, actual=${ar.actual ?? "N/A"}${ar.message ? ` - ${ar.message}` : ""}`
        );
      }
    }
    lines.push(``);
  }

  // Add execution URL
  if (summary.executionUrl) {
    lines.push(`**URL:** ${summary.executionUrl}`);
  }

  if (!summary.recorded) {
    lines.push(``);
    lines.push(`**Warning:** Results were not saved to the server (quota exceeded).`);
  }

  return lines.join("\n");
}

interface ProgressSender {
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: {
    method: "notifications/progress";
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }) => Promise<void>;
}

async function sendProgressNotification(
  extra: ProgressSender,
  event: StepCompleteEvent
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;

  const icon =
    event.status === "passed"
      ? "PASS"
      : event.status === "failed"
        ? "FAIL"
        : event.status === "error"
          ? "ERROR"
          : "SKIP";

  try {
    await extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress: event.index + 1,
        total: event.totalSteps,
        message: `[${icon}] ${event.scenarioName} / ${event.stepKey}`,
      },
    });
  } catch {
    // Progress notification failure is non-critical
  }
}

// Track background executions within this MCP server process
const backgroundExecutions = new Map<
  string,
  { promise: Promise<ExecutionSummary>; planName: string }
>();

export function registerExecutionTools(
  server: McpServer,
  client: AquaClient
) {
  server.tool(
    "execute_qa_plan",
    `Execute a QA plan. Runs all scenarios sequentially and reports results to the server.

Execution modes:
- async=false (default): Waits for all steps to complete and returns the full result. Use get_execution_progress to monitor progress from another tool call if needed.
- async=true: Starts execution in the background and immediately returns the Execution ID. Use get_execution_progress to poll for progress.

Execution behavior:
- Scenarios run sequentially in the order they are defined.
- depends_on works ACROSS scenarios: a step can reference step_keys from any previous scenario.
- Extracted variables (via extract) are shared across scenarios: a value extracted in scenario 1 is available as {{variable}} in scenario 2.
- Browser context (Playwright) is created fresh per scenario, but session cookies and localStorage are automatically carried over to the next scenario via storageState.
- Within a scenario, browser steps share the same browser instance (page, cookies, etc.).
- HTTP steps, browser steps, and wait steps can be mixed within a scenario. They operate independently but share variables.

Step action types:
- http_request: Send HTTP requests and assert on responses.
- browser: Automate browser interactions via Playwright.
- wait: Wait for a condition. Fixed delay (duration_ms) or HTTP polling (poll + until).

IMPORTANT: If execution fails, do NOT silently adjust the QA Plan to make it pass. Instead, analyze the failure details, report the findings to the user, and discuss the next steps before making any changes.`,
    {
      qa_plan_id: z.string().describe("QA Plan ID to execute"),
      version: z
        .number()
        .optional()
        .describe("Specific version to execute (defaults to latest)"),
      env_name: z
        .string()
        .optional()
        .describe(
          "Environment name to load from .aqua/environments/{env_name}.json"
        ),
      environment: z
        .record(z.string())
        .optional()
        .describe("Variable overrides for this execution (highest priority)"),
      async: z
        .boolean()
        .optional()
        .describe(
          "If true, starts execution in the background and returns immediately with the Execution ID. Use get_execution_progress to poll for progress. Defaults to false."
        ),
    },
    async ({ qa_plan_id, version, env_name, environment, async: asyncMode }, extra) => {
      const plan = await client.getQAPlan(qa_plan_id);

      if (asyncMode) {
        // Async mode: start execution in background
        let executionId: string | undefined;
        let executionUrl: string | undefined;

        const executionPromise = executeQAPlan(client, {
          qaPlanId: qa_plan_id,
          version,
          envName: env_name,
          vars: environment,
          onExecutionCreated: (id, url) => {
            executionId = id;
            executionUrl = url;
          },
          onStepComplete: (event) => sendProgressNotification(extra, event),
        });

        // Wait for execution creation (but not completion)
        // Poll until executionId is set or the promise settles
        const raceResult = await Promise.race([
          executionPromise.then((summary) => ({ type: "completed" as const, summary })),
          new Promise<{ type: "created" }>((resolve) => {
            const check = () => {
              if (executionId) {
                resolve({ type: "created" });
              } else {
                setTimeout(check, 50);
              }
            };
            check();
          }),
        ]);

        if (raceResult.type === "completed") {
          // Execution finished before we could return async
          return {
            content: [
              {
                type: "text" as const,
                text: formatExecutionResult(plan.name, raceResult.summary),
              },
            ],
          };
        }

        // Track the background execution
        backgroundExecutions.set(executionId!, {
          promise: executionPromise,
          planName: plan.name,
        });
        executionPromise.finally(() => {
          // Keep entry for 10 minutes after completion for get_execution_progress
          setTimeout(() => backgroundExecutions.delete(executionId!), 10 * 60 * 1000);
        });

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Execution started in background.`,
                ``,
                `**Execution ID:** ${executionId}`,
                `**URL:** ${executionUrl}`,
                ``,
                `Use \`get_execution_progress\` to check progress.`,
              ].join("\n"),
            },
          ],
        };
      }

      // Sync mode (default): wait for completion
      let summary;
      try {
        summary = await executeQAPlan(client, {
          qaPlanId: qa_plan_id,
          version,
          envName: env_name,
          vars: environment,
          onStepComplete: (event) => sendProgressNotification(extra, event),
        });
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatExecutionResult(plan.name, summary),
          },
        ],
      };
    }
  );

  server.tool(
    "get_execution",
    "Get execution results including step details",
    {
      execution_id: z.string().describe("Execution ID"),
    },
    async ({ execution_id }) => {
      const execution = await client.getExecution(execution_id);
      const steps = await client.listStepExecutions(execution_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ execution, steps }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_executions",
    "List executions with optional filtering. Results are paginated (default 20 per page). Use next_cursor from the response to fetch subsequent pages.",
    {
      qa_plan_version_id: z
        .string()
        .optional()
        .describe("Filter by plan version ID"),
      qa_plan_id: z
        .string()
        .optional()
        .describe(
          "Filter by QA plan ID (returns executions across all versions of the plan)"
        ),
      status: z
        .string()
        .optional()
        .describe("Filter by status: pending, running, completed, failed, error"),
      limit: z.number().optional().describe("Maximum number of results per page"),
      cursor: z
        .string()
        .optional()
        .describe("Cursor for pagination. Use next_cursor from previous response to get next page"),
    },
    async ({ qa_plan_version_id, qa_plan_id, status, limit, cursor }) => {
      const result = await client.listExecutions({
        qa_plan_version_id,
        qa_plan_id,
        status,
        limit,
        cursor,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
