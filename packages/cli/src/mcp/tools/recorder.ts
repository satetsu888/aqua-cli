import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordBrowserActions } from "../../recorder/recorder.js";

export function registerRecorderTools(server: McpServer) {
  server.tool(
    "record_browser_actions",
    `Record browser actions by opening a real browser for the user to operate.
Opens a Chromium browser using Playwright's codegen recorder.
The user performs actions in the browser while they are automatically recorded.
When the user closes the browser, the recorded actions are returned as BrowserStep[].

Input field values (fill actions) are automatically replaced with {{variable_name}} template variables derived from the field's label, placeholder, or id. The original values are not included in the output. You need to configure corresponding variable values in an environment file or pass them as execution parameters.

Use the returned steps with update_qa_plan, create_common_scenario, or run_scenario.`,
    {
      url: z
        .string()
        .optional()
        .describe(
          "Initial URL to navigate to (e.g. https://example.com/login)"
        ),
    },
    async ({ url }) => {
      try {
        const result = await recordBrowserActions({ url });

        const lines: string[] = [];
        lines.push("# Recorded Browser Actions");
        lines.push("");

        if (result.steps.length === 0) {
          lines.push("No actions were recorded.");
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        lines.push(`${result.steps.length} step(s) recorded.`);
        lines.push("");

        if (result.warnings.length > 0) {
          lines.push("## Warnings");
          for (const w of result.warnings) {
            lines.push(`- ${w}`);
          }
          lines.push("");
        }

        if (result.inputVariables.length > 0) {
          lines.push("## Input Variables");
          lines.push(
            "Input field values have been replaced with template variables. Configure actual values in your environment or pass as variables when executing:"
          );
          lines.push("");
          for (const v of result.inputVariables) {
            lines.push(`- \`{{${v}}}\``);
          }
          lines.push("");
        }

        lines.push("## Steps (BrowserStep[])");
        lines.push("```json");
        lines.push(JSON.stringify(result.steps, null, 2));
        lines.push("```");
        lines.push("");
        lines.push(
          "Use these steps in `update_qa_plan`, `create_common_scenario`, or `run_scenario`."
        );

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
