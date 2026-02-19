import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AquaClient } from "../../api/client.js";
import { executeQAPlan } from "../../commands/execute.js";

export function registerExecutionTools(
  server: McpServer,
  client: AquaClient
) {
  server.tool(
    "execute_qa_plan",
    `Execute a QA plan. Runs all scenarios sequentially and reports results to the server.

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
    },
    async ({ qa_plan_id, version, env_name, environment }) => {
      const plan = await client.getQAPlan(qa_plan_id);

      let summary;
      try {
        summary = await executeQAPlan(client, {
          qaPlanId: qa_plan_id,
          version,
          envName: env_name,
          vars: environment,
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

      // Format result
      const lines: string[] = [
        `# Execution Result: ${plan.name}`,
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
        lines.push(
          `## ${icon} ${result.scenarioName} / ${result.stepKey}`
        );

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
      lines.push(`**URL:** ${summary.executionUrl}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
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
