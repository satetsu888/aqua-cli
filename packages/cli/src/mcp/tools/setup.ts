import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AquaClient } from "../../api/client.js";
import { AquaConfig } from "../../config/index.js";
import { listEnvironments } from "../../environment/index.js";

export function registerSetupTools(
  server: McpServer,
  client: AquaClient,
  config: AquaConfig | null | undefined
) {
  server.tool(
    "check_project_setup",
    "Check the current project setup status. Returns a summary of project memory, environment configurations, and common scenarios with recommendations for what needs to be configured. Call this when starting work on a project to understand its current state.",
    {},
    async () => {
      const lines: string[] = ["# Project Setup Status", ""];
      const hasProjectKey = !!config?.project_key;

      // 1. Local Configuration
      if (config) {
        lines.push("## Local Configuration: ✓ Initialized");
        lines.push(`- Server URL: ${config.server_url}`);
        if (config.project_key) {
          lines.push(`- Project Key: ${config.project_key}`);
        }
      } else {
        lines.push("## Local Configuration: ⚠ Not initialized");
        lines.push(
          "Run `npx @aquaqa/cli init --server-url <server_url>` to initialize the project."
        );
      }
      lines.push("");

      // 2. Project Memory (requires project key)
      let hasMemory = false;
      if (hasProjectKey) {
        const { content: memoryContent } = await client.getProjectMemory();
        hasMemory =
          !!memoryContent && !memoryContent.includes("This is a TEMPLATE");

        if (hasMemory) {
          lines.push("## Project Memory: ✓ Has content");
          lines.push(
            "Project memory contains knowledge about the target application."
          );
          lines.push(
            "Review it with get_project_memory before creating QA plans to leverage existing insights."
          );
        } else {
          lines.push("## Project Memory: ℹ Empty");
          lines.push("No project knowledge has been recorded yet.");
          lines.push(
            "Knowledge will accumulate as you create and execute QA plans — save insights about app architecture, auth flows, UI selectors, and test creation tips with save_project_memory."
          );
        }
      } else {
        lines.push("## Project Memory: ℹ Requires project setup");
        lines.push(
          "Initialize the project to check project memory status."
        );
      }
      lines.push("");

      // 3. Environments (local check, no server needed)
      const environments = await listEnvironments();

      if (environments.length > 0) {
        lines.push(
          `## Environments: ✓ ${environments.length} environment(s) available`
        );
        for (const env of environments) {
          lines.push(`- ${env.name}`);
        }
      } else {
        lines.push("## Environments: ⚠ None found");
        lines.push(
          "No environment configurations exist in .aqua/environments/."
        );
        lines.push(
          "→ Ask the user about the target environment (URLs, credentials, proxy) and create one with create_environment."
        );
      }
      lines.push("");

      // 4. Common Scenarios (requires project key)
      if (hasProjectKey) {
        const commonScenarios = await client.listCommonScenarios();

        if (commonScenarios.length > 0) {
          lines.push(
            `## Common Scenarios: ✓ ${commonScenarios.length} scenario(s) available`
          );
          for (const cs of commonScenarios) {
            lines.push(`- ${cs.name}`);
          }
        } else {
          lines.push("## Common Scenarios: ℹ None found");
          lines.push("No common scenario templates exist yet.");
          lines.push(
            "→ Consider creating common scenarios (e.g. login, data setup) as you develop QA plans with create_common_scenario."
          );
        }
      } else {
        lines.push("## Common Scenarios: ℹ Requires project setup");
        lines.push(
          "Initialize the project to check common scenarios."
        );
      }
      lines.push("");

      // Recommendations
      const recommendations: string[] = [];
      if (!config) {
        recommendations.push(
          "Initialize the project with `npx @aquaqa/cli init --server-url <server_url>`"
        );
      }
      if (environments.length === 0) {
        recommendations.push(
          "Create an environment configuration for the target application"
        );
      }
      if (hasProjectKey && hasMemory) {
        recommendations.push(
          "Review project memory with get_project_memory before planning"
        );
      }
      if (config) {
        recommendations.push("Proceed to create or execute QA plans");
      }
      if (hasProjectKey && !hasMemory) {
        recommendations.push(
          "After executing plans, save any insights learned to project memory"
        );
      }

      if (!config || environments.length === 0) {
        lines.push("## Recommended Next Steps");
        for (let i = 0; i < recommendations.length; i++) {
          lines.push(`${i + 1}. ${recommendations[i]}`);
        }
      } else {
        lines.push("## Ready");
        lines.push(
          "Project has environment configuration. Proceed to create or execute QA plans."
        );
        if (hasProjectKey && hasMemory) {
          lines.push(
            "Use get_project_memory to review existing knowledge before planning."
          );
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
