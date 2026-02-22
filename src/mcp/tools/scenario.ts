import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AquaClient } from "../../api/client.js";
import { ScenarioRunner } from "../../driver/scenario-runner.js";
import { loadEnvironment } from "../../environment/index.js";
import { collectVariableReferences } from "../../utils/template.js";
import { Masker } from "../../masking/index.js";
import type { MaskContext } from "../../masking/index.js";
import type { Scenario, Step, StepResult } from "../../qa-plan/types.js";
import { StepSchema } from "./qa-plan.js";

// run_scenario always requires name and steps (no common_scenario_id support)
const InlineScenarioSchema = z.object({
  name: z.string().describe("Scenario name"),
  requires: z.array(z.string()).optional().describe(
    "Variable names required for this scenario to execute."
  ),
  steps: z.array(StepSchema).describe("Steps in this scenario"),
});

export function registerScenarioTools(
  server: McpServer,
  client: AquaClient,
) {
  server.tool(
    "run_scenario",
    `Execute a complete scenario definition in a single call for batch validation.
Use this when you ALREADY have a fully-defined scenario (steps, selectors, assertions) and want to verify it works as a whole.

This is a lightweight execution that does NOT record results to the server.
For recorded executions, use execute_qa_plan instead.

WHEN TO USE run_scenario vs start_exploration:
- run_scenario: You already know the correct selectors and page flow. Validate the complete scenario in one call.
- start_exploration: You DON'T know the page structure yet. Explore interactively one action at a time to discover selectors and API response formats first.

Results include detailed information for debugging:
- HTTP response bodies (truncated to 2000 chars)
- Assertion results with expected/actual values
- Extracted variable values
- Browser screenshots saved locally (file paths returned)

Secrets are masked in the response for safety.`,
    {
      scenario: InlineScenarioSchema.describe("Scenario definition with name and steps"),
      env_name: z
        .string()
        .optional()
        .describe("Environment name to load from .aqua/environments/{env_name}.json"),
      environment: z
        .record(z.string())
        .optional()
        .describe("Variable overrides (highest priority)"),
      qa_plan_id: z
        .string()
        .optional()
        .describe("QA Plan ID to pull default variables from"),
      version: z
        .number()
        .optional()
        .describe("Plan version to use for variables (defaults to latest)"),
    },
    async ({ scenario, env_name, environment, qa_plan_id, version }, extra) => {
      // Build variables from plan
      let planVariables: Record<string, string> = {};
      if (qa_plan_id) {
        try {
          const plan = await client.getQAPlan(qa_plan_id);
          let planVersion;
          if (version) {
            planVersion = await client.getQAPlanVersion(qa_plan_id, version);
          } else {
            planVersion = plan.latest_version;
          }
          if (planVersion?.variables) {
            planVariables = planVersion.variables;
          }
        } catch (err) {
          return {
            content: [{
              type: "text" as const,
              text: `Error loading plan variables: ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }

      // Convert scenario input to internal Scenario type
      const internalScenario: Scenario = {
        id: "adhoc",
        name: scenario.name,
        requires: scenario.requires,
        sort_order: 0,
        steps: scenario.steps.map((st, idx): Step => ({
          id: `adhoc_${idx}`,
          step_key: st.step_key,
          action: st.action,
          config: st.config as Step["config"],
          assertions: st.assertions as Step["assertions"],
          extract: st.extract,
          depends_on: st.depends_on,
          sort_order: idx,
        })),
      };

      // Collect variable references to resolve only needed secrets
      const requiredKeys = collectVariableReferences(internalScenario);

      // Load environment file if env_name is specified
      let resolvedEnv;
      if (env_name) {
        try {
          resolvedEnv = await loadEnvironment(env_name, requiredKeys);
        } catch (err) {
          return {
            content: [{
              type: "text" as const,
              text: `Error loading environment "${env_name}": ${err instanceof Error ? err.message : String(err)}`,
            }],
            isError: true,
          };
        }
      }

      // Build resolved variables (plan < env < override)
      const variables: Record<string, string> = {};
      if (Object.keys(planVariables).length > 0) {
        Object.assign(variables, planVariables);
      }
      if (resolvedEnv) {
        Object.assign(variables, resolvedEnv.variables);
      }
      if (environment) {
        Object.assign(variables, environment);
      }

      // Build masker
      const maskCtx: MaskContext = {
        secretKeys: resolvedEnv?.secretKeys ?? new Set(),
        secretValues: resolvedEnv?.secretValues ?? new Set(),
      };
      const masker = new Masker(maskCtx);

      // Execute scenario
      const runner = new ScenarioRunner(resolvedEnv?.proxy);
      let result;
      try {
        const progressToken = extra._meta?.progressToken;
        result = await runner.run(internalScenario, variables, masker, (event) => {
          if (progressToken === undefined) return;
          const icon =
            event.status === "passed"
              ? "PASS"
              : event.status === "failed"
                ? "FAIL"
                : event.status === "error"
                  ? "ERROR"
                  : "SKIP";
          extra.sendNotification({
            method: "notifications/progress" as const,
            params: {
              progressToken,
              progress: event.index + 1,
              total: event.totalSteps,
              message: `[${icon}] ${event.scenarioName} / ${event.stepKey}`,
            },
          }).catch(() => { /* non-critical */ });
        });
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }

      // Format result
      return { content: formatResultContent(scenario.name, result, masker) };
    }
  );
}

type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function formatResultContent(
  scenarioName: string,
  result: import("../../driver/scenario-runner.js").ScenarioRunResult,
  masker: Masker,
): ContentBlock[] {
  const lines: string[] = [
    `# Scenario Result: ${scenarioName}`,
    ``,
    `**Status:** ${result.status}`,
    `**Steps:** ${result.totalSteps} total (${result.passed} passed, ${result.failed} failed, ${result.errors} errors, ${result.skipped} skipped)`,
    ``,
  ];

  for (const stepResult of result.results) {
    const icon =
      stepResult.status === "passed"
        ? "[PASS]"
        : stepResult.status === "failed"
          ? "[FAIL]"
          : stepResult.status === "error"
            ? "[ERROR]"
            : "[SKIP]";

    lines.push(`## ${icon} ${stepResult.stepKey} (${stepResult.action})`);

    if (stepResult.errorMessage) {
      lines.push(`Error: ${stepResult.errorMessage}`);
    }

    // HTTP response details
    if (stepResult.response) {
      const config = stepResult.action === "http_request" ? "(request details in config)" : "";
      lines.push(`HTTP ${stepResult.response.status} (${stepResult.response.duration}ms) ${config}`.trim());

      if (stepResult.response.body) {
        const maskedBody = masker.mask("http_response", stepResult.response.body) as string;
        const truncatedBody = maskedBody.length > 2000
          ? maskedBody.substring(0, 2000) + "...(truncated)"
          : maskedBody;
        lines.push(`Response body:`);
        lines.push("```");
        lines.push(truncatedBody);
        lines.push("```");
      }
    }

    // Assertion results
    if (stepResult.assertionResults && stepResult.assertionResults.length > 0) {
      lines.push(`### Assertions`);
      for (const ar of stepResult.assertionResults) {
        const mark = ar.passed ? "PASS" : "FAIL";
        lines.push(
          `- [${mark}] ${ar.type}: expected=${ar.expected ?? "N/A"}, actual=${ar.actual ?? "N/A"}${ar.message ? ` - ${ar.message}` : ""}`
        );
      }
    }

    // Extracted values
    if (stepResult.extractedValues && Object.keys(stepResult.extractedValues).length > 0) {
      lines.push(`### Extracted Values`);
      for (const [key, value] of Object.entries(stepResult.extractedValues)) {
        const maskedValue = masker.mask("http_response", value) as string;
        lines.push(`- ${key} = ${maskedValue}`);
      }
    }

    lines.push(``);
  }

  // Variables section
  const varEntries = Object.entries(result.resolvedVariables);
  if (varEntries.length > 0) {
    lines.push(`## Variables After Execution`);
    for (const [key, value] of varEntries) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  const content: ContentBlock[] = [
    { type: "text" as const, text: lines.join("\n") },
  ];

  // Collect screenshots as inline image content
  for (const stepResult of result.results) {
    if (stepResult.browserArtifacts) {
      for (const artifact of stepResult.browserArtifacts) {
        if (artifact.type === "screenshot") {
          content.push({
            type: "image" as const,
            data: artifact.data.toString("base64"),
            mimeType: "image/png",
          });
        }
      }
    }
  }

  return content;
}
