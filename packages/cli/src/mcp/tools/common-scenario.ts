import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AquaClient } from "../../api/client.js";
import { StepSchema } from "./qa-plan.js";
import { unescapeUnicode } from "../sanitize.js";

export function registerCommonScenarioTools(
  server: McpServer,
  client: AquaClient
) {
  server.tool(
    "create_common_scenario",
    "Create a reusable common scenario template at the project level. Common scenarios can be referenced in QA plans via common_scenario_id to avoid duplicating frequently-used scenarios (e.g. login, data setup, cleanup).",
    {
      name: z.string().describe("Scenario name"),
      description: z
        .string()
        .optional()
        .describe("Description of what this scenario does"),
      requires: z
        .array(z.string())
        .optional()
        .describe("Variable names required for this scenario to execute"),
      steps: z.array(StepSchema).describe("Steps in this scenario"),
    },
    async ({ name, description, requires, steps }) => {
      const cs = await client.createCommonScenario({
        name: unescapeUnicode(name),
        description: unescapeUnicode(description ?? ""),
        requires,
        steps: steps.map((s) => ({
          step_key: s.step_key,
          action: s.action,
          config: s.config as Record<string, unknown>,
          assertions: s.assertions as
            | Array<Record<string, unknown>>
            | undefined,
          extract: s.extract,
          depends_on: s.depends_on,
        })),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(cs, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_common_scenario",
    "Get a common scenario by ID",
    {
      id: z.string().describe("Common scenario ID"),
    },
    async ({ id }) => {
      const cs = await client.getCommonScenario(id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(cs, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_common_scenarios",
    "List all common scenarios in the current project. Use this to see available reusable scenario templates before creating QA plans.",
    {},
    async () => {
      const scenarios = await client.listCommonScenarios();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(scenarios, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "update_common_scenario",
    "Update an existing common scenario. Only specified fields are changed.",
    {
      id: z.string().describe("Common scenario ID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      requires: z
        .array(z.string())
        .optional()
        .describe("New required variable names"),
      steps: z
        .array(StepSchema)
        .optional()
        .describe("New steps (replaces all steps)"),
    },
    async ({ id, name, description, requires, steps }) => {
      const cs = await client.updateCommonScenario(id, {
        name: name ? unescapeUnicode(name) : undefined,
        description: description ? unescapeUnicode(description) : undefined,
        requires,
        steps: steps?.map((s) => ({
          step_key: s.step_key,
          action: s.action,
          config: s.config as Record<string, unknown>,
          assertions: s.assertions as
            | Array<Record<string, unknown>>
            | undefined,
          extract: s.extract,
          depends_on: s.depends_on,
        })),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(cs, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "delete_common_scenario",
    "Delete a common scenario. This does not affect QA plans that have already copied this scenario.",
    {
      id: z.string().describe("Common scenario ID"),
    },
    async ({ id }) => {
      await client.deleteCommonScenario(id);
      return {
        content: [
          {
            type: "text" as const,
            text: "Common scenario deleted successfully.",
          },
        ],
      };
    }
  );
}
