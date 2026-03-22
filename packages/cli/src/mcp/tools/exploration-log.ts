import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listExplorationLogs,
  getExplorationLog,
} from "../../exploration/log.js";

export function registerExplorationLogTools(
  server: McpServer,
  projectKey?: string,
) {
  server.tool(
    "list_exploration_logs",
    `List recent exploration session logs for this project.
Each log contains the sequence of actions performed during an exploration session.
Use this to find previous exploration sessions whose action sequences you can replay.`,
    {
      limit: z
        .number()
        .optional()
        .describe("Maximum number of sessions to return (default: 10)"),
    },
    async ({ limit }) => {
      const logs = listExplorationLogs(projectKey, limit);

      if (logs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No exploration logs found for this project.",
            },
          ],
        };
      }

      const lines: string[] = ["**Recent exploration sessions:**", ""];

      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        const successCount = log.actions.filter((a) => a.success).length;
        const totalCount = log.actions.length;

        // Find last browser URL
        const lastBrowserAction = [...log.actions]
          .reverse()
          .find((a) => a.url_after);
        const lastUrl = lastBrowserAction?.url_after ?? "N/A";

        const startedDate = new Date(log.started_at);
        const dateStr = startedDate.toISOString().replace("T", " ").slice(0, 16);

        lines.push(
          `${i + 1}. **${dateStr}** (session: \`${log.session_id}\`) - ${totalCount} actions, ${successCount} successful`,
        );
        lines.push(`   Last URL: ${lastUrl}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  server.tool(
    "get_exploration_log",
    `Get the full action log from a specific exploration session.
Returns all actions (browser steps, HTTP requests, assertions) with their inputs and success/failure status.
Use this to review what was done in a previous session, then pass successful browser steps to explore_action's browser_steps parameter to replay them.`,
    {
      session_id: z
        .string()
        .describe("Session ID from list_exploration_logs"),
    },
    async ({ session_id }) => {
      const log = getExplorationLog(session_id, projectKey);

      if (!log) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Exploration log not found for session: ${session_id}`,
            },
          ],
          isError: true,
        };
      }

      const lines: string[] = [
        `**Session:** \`${log.session_id}\``,
        `**Started:** ${log.started_at}`,
        `**Updated:** ${log.updated_at}`,
        `**Actions:** ${log.actions.length}`,
        "",
      ];

      if (log.actions.length === 0) {
        lines.push("No actions recorded.");
      } else {
        for (let i = 0; i < log.actions.length; i++) {
          const action = log.actions[i];
          const icon = action.success ? "PASS" : "FAIL";
          lines.push(`### ${i + 1}. [${icon}] ${action.type}`);
          lines.push("```json");
          lines.push(JSON.stringify(action.input, null, 2));
          lines.push("```");
          if (action.error) {
            lines.push(`**Error:** ${action.error}`);
          }
          if (action.url_after) {
            lines.push(`**URL after:** ${action.url_after}`);
          }
          if (action.http_status !== undefined) {
            lines.push(`**HTTP status:** ${action.http_status}`);
          }
          lines.push("");
        }

        // Summary of successful browser steps for easy copy-paste
        const successfulBrowserSteps = log.actions
          .filter((a) => a.type === "browser_step" && a.success)
          .map((a) => a.input);

        if (successfulBrowserSteps.length > 0) {
          lines.push("---");
          lines.push(
            "### Successful browser steps (for replay with browser_steps)",
          );
          lines.push("```json");
          lines.push(JSON.stringify(successfulBrowserSteps, null, 2));
          lines.push("```");
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
