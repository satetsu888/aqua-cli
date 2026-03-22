import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AquaClient } from "../../api/client.js";

export function registerProgressTools(
  server: McpServer,
  client: AquaClient
) {
  server.tool(
    "get_execution_progress",
    `Get the current progress of an execution. Use this to check on an async execution started with execute_qa_plan(async=true), or to monitor any running execution.

Returns step-by-step progress including which steps have completed and their results.`,
    {
      execution_id: z.string().describe("Execution ID to check progress for"),
    },
    async ({ execution_id }) => {
      const execution = await client.getExecution(execution_id);
      const steps = await client.listStepExecutions(execution_id);

      const completed = steps.filter(
        (s) => s.status !== "pending" && s.status !== "running"
      );
      const passed = steps.filter((s) => s.status === "passed").length;
      const failed = steps.filter((s) => s.status === "failed").length;
      const errors = steps.filter((s) => s.status === "error").length;
      const skipped = steps.filter((s) => s.status === "skipped").length;
      const running = steps.filter((s) => s.status === "running");

      const lines: string[] = [
        `# Execution Progress`,
        ``,
        `**Execution ID:** ${execution.id}`,
        `**Status:** ${execution.status}`,
        `**URL:** ${execution.url}`,
        ``,
      ];

      // Progress summary
      if (execution.status === "running") {
        lines.push(
          `**Progress:** ${completed.length} / ${steps.length > 0 ? steps.length : "?"} steps completed`
        );
        if (running.length > 0) {
          const current = running[0];
          lines.push(
            `**Current:** ${current.scenario_name} / ${current.step_key} (${current.action})`
          );
        }
      } else {
        lines.push(`**Steps:** ${steps.length} total`);
      }

      lines.push(`- Passed: ${passed}`);
      lines.push(`- Failed: ${failed}`);
      lines.push(`- Errors: ${errors}`);
      lines.push(`- Skipped: ${skipped}`);
      lines.push(``);

      // Completed steps detail
      if (completed.length > 0) {
        lines.push(`## Completed Steps`);
        let currentScenario = "";
        for (const step of completed) {
          if (step.scenario_name !== currentScenario) {
            currentScenario = step.scenario_name;
            lines.push(`### ${currentScenario}`);
          }
          const icon =
            step.status === "passed"
              ? "[PASS]"
              : step.status === "failed"
                ? "[FAIL]"
                : step.status === "error"
                  ? "[ERROR]"
                  : "[SKIP]";
          let line = `- ${icon} ${step.step_key} (${step.action})`;
          if (step.error_message) {
            line += ` — ${step.error_message}`;
          }
          if (step.started_at && step.finished_at) {
            const duration =
              new Date(step.finished_at).getTime() -
              new Date(step.started_at).getTime();
            line += ` (${duration}ms)`;
          }
          lines.push(line);
        }
        lines.push(``);
      }

      // Running steps
      if (running.length > 0) {
        lines.push(`## Currently Running`);
        for (const step of running) {
          lines.push(
            `- ${step.scenario_name} / ${step.step_key} (${step.action})`
          );
        }
        lines.push(``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
