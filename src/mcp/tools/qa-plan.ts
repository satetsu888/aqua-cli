import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AquaClient } from "../../api/client.js";
import { detectCurrentBranch, detectPullRequestURL } from "../../setup/git.js";
import {
  AssertionSchema,
  HttpRequestConfigSchema,
  BrowserConfigSchema,
} from "../../qa-plan/types.js";
import { unescapeUnicode } from "../sanitize.js";

export const ASSERTIONS_DESCRIPTION = `Assertions to evaluate after step execution. Examples:

http_request: { type: "status_code", expected: 200 }, { type: "status_code_in", expected: [200, 201] }, { type: "json_path", path: "$.data.name", expected: "test" }, { type: "json_path", path: "$.data.id", condition: "exists" }, { type: "json_path", path: "$.msg", condition: "contains", expected: "hello" }

browser: { type: "element_text", selector: "h1", contains: "Welcome" }, { type: "element_visible", selector: "#btn" }, { type: "element_not_visible", selector: ".modal" }, { type: "url_contains", expected: "/dashboard" }, { type: "title", expected: "Home" }, { type: "screenshot", name: "result" }, { type: "element_count", selector: ".item", expected: 5 }, { type: "element_attribute", selector: "#btn", attribute: "disabled", expected: "true" }, { type: "cookie_exists", name: "session_id" }, { type: "cookie_value", name: "theme", expected: "dark" }, { type: "localstorage_exists", key: "auth_token" }, { type: "localstorage_value", key: "lang", expected: "ja", match: "exact" }`;

export const CONFIG_DESCRIPTION = `Examples:

http_request: { method: "GET", url: "{{api_base_url}}/users", headers: { "Authorization": "Bearer {{token}}" } }
http_request (POST): { method: "POST", url: "{{api_base_url}}/users", headers: { "Content-Type": "application/json" }, body: { name: "test" } }
http_request (polling): { method: "GET", url: "{{api_base_url}}/jobs/{{job_id}}", poll: { until: { type: "json_path", path: "$.status", expected: "completed" }, interval_ms: 1000, timeout_ms: 30000 } }

browser: { steps: [{ goto: "{{web_base_url}}/login" }, { type: { selector: "#email", text: "user@example.com" } }, { click: "#submit" }, { wait_for_selector: ".dashboard" }, { screenshot: "result" }] }
browser (mobile): { viewport: "mobile", steps: [{ goto: "{{web_base_url}}" }, { click: ".hamburger-menu" }, { screenshot: "mobile_menu" }] }

Available browser actions (these are ALL supported actions): goto (navigate to URL), click (CSS selector), double_click (CSS selector), type (fill input field: { selector, text }), hover (CSS selector), select_option (dropdown: { selector, value }), check (checkbox CSS selector), uncheck (checkbox CSS selector), press (keyboard: { selector, key } where key is e.g. Enter, Tab, Escape), focus (CSS selector), wait_for_selector (wait for element to appear), wait_for_url (wait for URL to contain substring), screenshot (capture screenshot), set_header (set extra HTTP headers), upload_file (file input: { selector, path }), switch_to_frame (CSS selector for iframe to switch into, e.g. 'iframe#payment'), switch_to_main_frame (switch back to top-level page: true).`;

export const stepCommonFields = {
  step_key: z.string().describe("Unique step identifier within the version"),
  assertions: z
    .array(AssertionSchema)
    .optional()
    .describe(ASSERTIONS_DESCRIPTION),
  extract: z
    .record(z.string())
    .optional()
    .describe(
      'Extract values from HTTP JSON response body using JSONPath expressions. Format: { variable_name: json_path_expression }. Example: { "user_id": "$.data.id" }. Extracted values are available as {{variable_name}} in subsequent steps across all scenarios.'
    ),
  depends_on: z
    .array(z.string())
    .optional()
    .describe(
      "Step keys this step depends on (can reference steps from any scenario). If any dependency step is not passed, this step will be skipped."
    ),
};

export const StepSchema = z.discriminatedUnion("action", [
  z.object({
    ...stepCommonFields,
    action: z.literal("http_request"),
    config: HttpRequestConfigSchema.describe("HTTP request configuration. " + CONFIG_DESCRIPTION),
  }),
  z.object({
    ...stepCommonFields,
    action: z.literal("browser"),
    config: BrowserConfigSchema.describe("Browser action configuration. " + CONFIG_DESCRIPTION),
  }),
]);

export const ScenarioSchema = z.object({
  name: z.string().optional().describe("Scenario name (required unless common_scenario_id is specified)"),
  requires: z.array(z.string()).optional().describe(
    "Variable names required for this scenario to execute. If any listed variable is not available in the environment at execution time, the entire scenario will be skipped. Use this for environment-specific scenarios (e.g. DB tests that need db_url)."
  ),
  steps: z.array(StepSchema).optional().describe("Steps in this scenario (required unless common_scenario_id is specified)"),
  common_scenario_id: z.string().optional().describe(
    "ID of a common scenario to include. When specified, name/steps/requires default to the common scenario's values but can be overridden. Use list_common_scenarios to see available templates."
  ),
}).refine(
  (data) => data.common_scenario_id || (data.name && data.steps && data.steps.length > 0),
  { message: "Either common_scenario_id or both name and steps are required" }
);

export function registerQAPlanTools(
  server: McpServer,
  client: AquaClient,
) {
  server.tool(
    "create_qa_plan",
    `Create a new QA plan. The project is automatically determined from the configured project_key.

Before creating a QA plan, run check_project_setup to ensure the project is configured.
If project memory exists, review it with get_project_memory for useful context.

This creates an empty plan with no versions. A plan cannot be executed until a version with scenarios and steps is added via update_qa_plan.`,
    {
      name: z.string().describe("Plan name"),
      description: z
        .string()
        .optional()
        .describe("Plan description"),
      git_branch: z
        .string()
        .optional()
        .describe("Git branch name. Auto-detected from current branch if not specified."),
      pull_request_url: z
        .string()
        .optional()
        .describe("Pull request URL. Auto-detected via gh CLI if not specified."),
    },
    async ({ name, description, git_branch, pull_request_url }) => {
      const plan = await client.createQAPlan({
        name: unescapeUnicode(name),
        description: unescapeUnicode(description ?? ""),
        git_branch: git_branch ?? detectCurrentBranch() ?? "",
        pull_request_url: pull_request_url ?? detectPullRequestURL() ?? "",
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(plan, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_qa_plan",
    "Get a QA plan by ID, including its latest version info",
    {
      id: z.string().describe("Plan ID"),
    },
    async ({ id }) => {
      const plan = await client.getQAPlan(id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(plan, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_qa_plans",
    "List QA plans with optional filtering. Returns plans from the configured project. Results are paginated (default 20 per page). Use next_cursor from the response to fetch subsequent pages.",
    {
      status: z
        .string()
        .optional()
        .describe("Filter by status: draft, active"),
      pinned: z
        .boolean()
        .optional()
        .describe("Filter by pinned status. true = only pinned plans, false = only unpinned plans"),
      include_archived: z
        .boolean()
        .optional()
        .describe("Include archived plans in results. Default: false (archived plans are hidden)"),
      git_branch: z
        .string()
        .optional()
        .describe("Filter by git branch name (exact match). Example: 'feature/login'"),
      pull_request_url: z
        .string()
        .optional()
        .describe("Filter by pull request URL (partial match). Example: 'pull/42' to find PR #42"),
      limit: z.number().optional().describe("Maximum number of results per page"),
      cursor: z
        .string()
        .optional()
        .describe("Cursor for pagination. Use next_cursor from previous response to get next page"),
    },
    async ({ status, pinned, include_archived, git_branch, pull_request_url, limit, cursor }) => {
      const result = await client.listQAPlans({
        status,
        pinned,
        include_archived,
        git_branch,
        pull_request_url,
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

  server.tool(
    "update_qa_plan",
    `Create a new immutable version of a QA plan with structured scenario/step data. Each call creates a new version; previous versions are preserved unchanged.

If project memory exists, review it with get_project_memory for useful context on the target application.

Supported step actions: http_request, browser.

Key behaviors:
- depends_on can reference step_keys from ANY scenario (not just the current one). Scenarios run sequentially, so earlier scenario steps are always available as dependencies.
- extract values are shared across all scenarios. A variable extracted in scenario 1 can be used as {{variable}} in scenario 2. HTTP steps extract via json_path.
- Browser session cookies and localStorage are automatically preserved across scenarios.
- Within a scenario, all browser steps share the same browser instance.
- http_request steps support polling via the poll option (poll.until + poll.interval_ms + poll.timeout_ms).`,
    {
      id: z.string().describe("Plan ID"),
      name: z.string().optional().describe("Version name (version number is auto-assigned)"),
      description: z
        .string()
        .optional()
        .describe("Version description"),
      variables: z
        .record(z.string())
        .optional()
        .describe('Default variable values as a JSON object (not a string). Example: { "api_base_url": "https://api.example.com", "timeout": "30" }. Overridden by environment files and execution arguments.'),
      scenarios: z
        .array(ScenarioSchema)
        .describe("Ordered list of test scenarios"),
    },
    async ({ id, name, description, variables, scenarios }) => {
      const version = await client.createQAPlanVersion(id, {
        name: name ? unescapeUnicode(name) : undefined,
        description: description ? unescapeUnicode(description) : undefined,
        variables,
        scenarios: scenarios.map((s) => ({
          name: unescapeUnicode(s.name ?? ""),
          common_scenario_id: s.common_scenario_id,
          requires: s.requires,
          steps: (s.steps ?? []).map((st) => ({
            step_key: st.step_key,
            action: st.action,
            config: st.config as Record<string, unknown>,
            assertions: st.assertions as Array<Record<string, unknown>> | undefined,
            extract: st.extract,
            depends_on: st.depends_on,
          })),
        })),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(version, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "set_qa_plan_state",
    "Update the state of a QA plan (status, pinned, archived). At least one field is required. Statuses: draft (initial, editable), active (approved for use). Archived plans cannot be executed or have new versions created - unarchive first. Note: when an execution completes with all steps passed, the plan automatically transitions from draft to active.",
    {
      id: z.string().describe("Plan ID"),
      status: z
        .string()
        .optional()
        .describe("New status: draft, active"),
      pinned: z
        .boolean()
        .optional()
        .describe("true to pin, false to unpin"),
      archived: z
        .boolean()
        .optional()
        .describe("true to archive, false to unarchive"),
    },
    async ({ id, status, pinned, archived }) => {
      const plan = await client.patchQAPlanState(id, { status, pinned, archived });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(plan, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "update_qa_plan_step",
    `Update a single step in a QA plan by creating a new version with the change applied.

Only the specified fields are updated; omitted fields are preserved from the base version.
This is more efficient than update_qa_plan when you only need to change one step.`,
    {
      qa_plan_id: z.string().describe("QA Plan ID"),
      step_key: z.string().describe("Step key to update"),
      version: z
        .number()
        .optional()
        .describe("Base version number (defaults to latest)"),
      action: z
        .enum(["http_request", "browser"])
        .optional()
        .describe("New action type"),
      config: z
        .union([HttpRequestConfigSchema, BrowserConfigSchema])
        .optional()
        .describe("New config (replaces entire config). " + CONFIG_DESCRIPTION),
      assertions: z
        .array(AssertionSchema)
        .optional()
        .describe("New assertions (replaces entire assertions list). " + ASSERTIONS_DESCRIPTION),
      extract: z
        .record(z.string())
        .optional()
        .describe("New extract rules (replaces entire extract)"),
      depends_on: z
        .array(z.string())
        .optional()
        .describe("New depends_on list (replaces entire list)"),
    },
    async ({ qa_plan_id, step_key, version, action, config, assertions, extract, depends_on }) => {
      try {
        let baseVersion = version;
        if (baseVersion === undefined) {
          const plan = await client.getQAPlan(qa_plan_id);
          if (!plan.latest_version) {
            return {
              content: [{ type: "text" as const, text: "Error: QA plan has no versions" }],
              isError: true,
            };
          }
          baseVersion = plan.latest_version.version;
        }

        const patch: import("../../api/client.js").PatchOperation = {
          op: "replace_step",
          step_key,
          action,
          config: config as Record<string, unknown> | undefined,
          assertions: assertions as Array<Record<string, unknown>> | undefined,
          extract,
          depends_on,
        };

        const result = await client.patchQAPlanVersion(qa_plan_id, {
          base_version: baseVersion,
          patches: [patch],
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "add_qa_plan_step",
    `Add a new step to a scenario in a QA plan by creating a new version with the step added.

The step is appended to the end of the scenario by default, or after a specific step if after_step_key is provided.`,
    {
      qa_plan_id: z.string().describe("QA Plan ID"),
      scenario_name: z.string().describe("Scenario to add the step to"),
      step_key: z.string().describe("Unique step key for the new step"),
      action: z
        .enum(["http_request", "browser"])
        .describe("Step action type"),
      config: z
        .union([HttpRequestConfigSchema, BrowserConfigSchema])
        .describe("Action-specific configuration. " + CONFIG_DESCRIPTION),
      version: z
        .number()
        .optional()
        .describe("Base version number (defaults to latest)"),
      after_step_key: z
        .string()
        .optional()
        .describe("Insert after this step key (appends to end if omitted)"),
      assertions: z
        .array(AssertionSchema)
        .optional()
        .describe(ASSERTIONS_DESCRIPTION),
      extract: z
        .record(z.string())
        .optional()
        .describe("Variable extraction rules"),
      depends_on: z
        .array(z.string())
        .optional()
        .describe("Step keys this step depends on"),
    },
    async ({ qa_plan_id, scenario_name, step_key, action, config, version, after_step_key, assertions, extract, depends_on }) => {
      try {
        let baseVersion = version;
        if (baseVersion === undefined) {
          const plan = await client.getQAPlan(qa_plan_id);
          if (!plan.latest_version) {
            return {
              content: [{ type: "text" as const, text: "Error: QA plan has no versions" }],
              isError: true,
            };
          }
          baseVersion = plan.latest_version.version;
        }

        const patch: import("../../api/client.js").PatchOperation = {
          op: "add_step",
          scenario_name,
          after_step_key,
          step: {
            step_key,
            action,
            config: config as Record<string, unknown>,
            assertions: assertions as Array<Record<string, unknown>> | undefined,
            extract,
            depends_on,
          },
        };

        const result = await client.patchQAPlanVersion(qa_plan_id, {
          base_version: baseVersion,
          patches: [patch],
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "remove_qa_plan_step",
    `Remove a step from a QA plan by creating a new version with the step removed.

Will fail if other steps reference this step in depends_on.`,
    {
      qa_plan_id: z.string().describe("QA Plan ID"),
      step_key: z.string().describe("Step key to remove"),
      version: z
        .number()
        .optional()
        .describe("Base version number (defaults to latest)"),
    },
    async ({ qa_plan_id, step_key, version }) => {
      try {
        let baseVersion = version;
        if (baseVersion === undefined) {
          const plan = await client.getQAPlan(qa_plan_id);
          if (!plan.latest_version) {
            return {
              content: [{ type: "text" as const, text: "Error: QA plan has no versions" }],
              isError: true,
            };
          }
          baseVersion = plan.latest_version.version;
        }

        const result = await client.patchQAPlanVersion(qa_plan_id, {
          base_version: baseVersion,
          patches: [{ op: "remove_step", step_key }],
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}
