import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AquaClient } from "../../api/client.js";
import { BrowserDriver } from "../../driver/browser.js";
import { HttpDriver } from "../../driver/http.js";
import { checkBrowserDependencies } from "../../driver/step-utils.js";
import { loadEnvironment } from "../../environment/index.js";
import type { ResolvedProxyConfig } from "../../environment/index.js";
import { Masker } from "../../masking/index.js";
import type { MaskContext } from "../../masking/index.js";
import { expandObject } from "../../utils/template.js";
import {
  BrowserStepSchema,
  HttpRequestConfigSchema,
  BrowserAssertionSchema,
} from "../../qa-plan/types.js";
import type { Step } from "../../qa-plan/types.js";

const SESSION_TIMEOUT_MS = 60_000;

interface ExplorationSession {
  id: string;
  browserDriver: BrowserDriver | null;
  httpDriver: HttpDriver;
  variables: Record<string, string>;
  masker: Masker;
  proxyConfig?: ResolvedProxyConfig;
  artifactDir: string;
  lastActivityAt: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, ExplorationSession>();

function resetSessionTimeout(session: ExplorationSession): void {
  clearTimeout(session.timeoutTimer);
  session.lastActivityAt = Date.now();
  session.timeoutTimer = setTimeout(() => {
    cleanupSession(session.id);
  }, SESSION_TIMEOUT_MS);
}

async function cleanupSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  clearTimeout(session.timeoutTimer);
  if (session.browserDriver) {
    await session.browserDriver.close();
  }
  sessions.delete(sessionId);
}

export function registerExplorationTools(
  server: McpServer,
  client: AquaClient,
) {
  server.tool(
    "start_exploration",
    `Start an interactive exploration session for investigating page structure, testing selectors, and examining API responses one action at a time.

Use this when you need to:
- Discover DOM structure and find correct CSS selectors before writing a QA plan
- Inspect API response formats and values to understand the target application
- Iteratively test individual actions with immediate feedback (navigate → inspect → click → inspect → ...)

The session keeps the browser alive between actions, so you can build up page state incrementally without relaunching the browser each time. Session auto-expires after 60 seconds of inactivity.

WHEN TO USE start_exploration vs run_scenario:
- start_exploration: You DON'T know the page structure yet. You need to explore interactively, discover selectors, inspect API responses, and gather information before building a scenario.
- run_scenario: You ALREADY have a complete scenario definition and want to validate it works in a single call. Use this for batch testing after exploration.

Typical workflow: start_exploration → explore_action (repeat) → end_exploration → build scenario → run_scenario → update_qa_plan`,
    {
      env_name: z
        .string()
        .optional()
        .describe(
          "Environment name to load from .aqua/environments/{env_name}.json"
        ),
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
    async ({ env_name, environment, qa_plan_id, version }) => {
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
            content: [
              {
                type: "text" as const,
                text: `Error loading plan variables: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }

      // Load environment file (all secrets, since we don't know which will be needed)
      let resolvedEnv;
      if (env_name) {
        try {
          resolvedEnv = await loadEnvironment(env_name);
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error loading environment "${env_name}": ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
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

      // Create artifact directory
      const artifactDir = await mkdtemp(join(tmpdir(), "aqua-explore-"));

      // Create session
      const sessionId = randomUUID();
      const session: ExplorationSession = {
        id: sessionId,
        browserDriver: null,
        httpDriver: new HttpDriver(resolvedEnv?.proxy),
        variables,
        masker,
        proxyConfig: resolvedEnv?.proxy,
        artifactDir,
        lastActivityAt: Date.now(),
        timeoutTimer: setTimeout(
          () => cleanupSession(sessionId),
          SESSION_TIMEOUT_MS
        ),
      };
      sessions.set(sessionId, session);

      const varCount = Object.keys(variables).length;
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Exploration session started.\n\n` +
              `**Session ID:** ${sessionId}\n` +
              `**Variables loaded:** ${varCount}\n` +
              `**Artifact directory:** ${artifactDir}\n` +
              `**Session timeout:** ${SESSION_TIMEOUT_MS / 1000}s (resets on each action)\n\n` +
              `Use explore_action to execute browser actions, HTTP requests, or browser assertions.\n` +
              `Use end_exploration to close the session when done.`,
          },
        ],
      };
    }
  );

  server.tool(
    "explore_action",
    `Execute a single action within an exploration session and get immediate feedback.
The session (and browser) stays alive between calls, so you can build up state incrementally.

Provide exactly ONE of: browser_step, http_request, or browser_assertion.

- browser_step: Execute a single browser action (goto, click, type, etc.).
  Returns the full page DOM HTML, a screenshot path, current URL, and page title after execution.
  Use the DOM to discover CSS selectors for subsequent actions.
- http_request: Send an HTTP request.
  Returns the response status, headers, and full body. Use extract to capture values into session variables for subsequent actions via {{variable}} templates.
- browser_assertion: Evaluate a single browser assertion (element_visible, element_text, etc.) to check page state without modifying it.`,
    {
      session_id: z
        .string()
        .describe("Session ID from start_exploration"),
      browser_step: BrowserStepSchema.optional().describe(
        'Single browser action to execute. Examples: { goto: "https://example.com" }, { click: "#submit" }, { type: { selector: "#email", text: "user@example.com" } }'
      ),
      http_request: HttpRequestConfigSchema.optional().describe(
        'HTTP request to execute. Example: { method: "GET", url: "https://api.example.com/users" }'
      ),
      browser_assertion: BrowserAssertionSchema.optional().describe(
        'Browser assertion to evaluate. Example: { type: "element_visible", selector: "#login-form" }'
      ),
      extract: z
        .record(z.string())
        .optional()
        .describe(
          'Extract values from HTTP response body using JSONPath. Example: { "user_id": "$.data.id" }. Extracted values become session variables usable as {{user_id}} in subsequent actions.'
        ),
      timeout_ms: z
        .number()
        .optional()
        .describe(
          "Timeout for this action in ms (default: 10000 for browser, 30000 for HTTP)"
        ),
    },
    async ({
      session_id,
      browser_step,
      http_request,
      browser_assertion,
      extract,
      timeout_ms,
    }) => {
      const session = sessions.get(session_id);
      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Session not found. It may have expired (timeout: 60s). Use start_exploration to create a new session.",
            },
          ],
          isError: true,
        };
      }

      resetSessionTimeout(session);

      // Validate exactly one action
      const actionCount = [browser_step, http_request, browser_assertion].filter(
        Boolean
      ).length;
      if (actionCount !== 1) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide exactly one of: browser_step, http_request, or browser_assertion.",
            },
          ],
          isError: true,
        };
      }

      if (browser_step) {
        return await executeBrowserStepAction(
          session,
          browser_step,
          timeout_ms
        );
      }

      if (http_request) {
        return await executeHttpAction(
          session,
          http_request,
          extract,
          timeout_ms
        );
      }

      if (browser_assertion) {
        return await executeBrowserAssertionAction(session, browser_assertion);
      }

      return {
        content: [{ type: "text" as const, text: "No action provided." }],
        isError: true,
      };
    }
  );

  server.tool(
    "end_exploration",
    `End an exploration session and clean up resources (close browser, release memory).
Always call this when you are done exploring to free up the browser process.
If you forget, the session will auto-expire after 60 seconds of inactivity.`,
    {
      session_id: z
        .string()
        .describe("Session ID from start_exploration"),
    },
    async ({ session_id }) => {
      const session = sessions.get(session_id);
      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Session not found (already expired or ended).",
            },
          ],
        };
      }

      const artifactDir = session.artifactDir;
      await cleanupSession(session_id);

      return {
        content: [
          {
            type: "text" as const,
            text: `Exploration session ended.\n\nArtifacts saved in: ${artifactDir}`,
          },
        ],
      };
    }
  );
}

async function executeBrowserStepAction(
  session: ExplorationSession,
  browserStep: z.infer<typeof BrowserStepSchema>,
  timeoutMs?: number,
): Promise<{ content: { type: "text"; text: string }[] }> {
  // Ensure browser driver exists (lazy initialization)
  if (!session.browserDriver) {
    try {
      await checkBrowserDependencies();
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Browser not available: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
    session.browserDriver = new BrowserDriver(undefined, session.proxyConfig);
  }

  // Expand variables in browser step
  const expandedStep = expandObject(browserStep, session.variables);

  let error: string | undefined;
  try {
    await session.browserDriver.executeSingleBrowserStep(
      expandedStep,
      timeoutMs
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Get page state (even if step failed, page might still have useful state)
  const state = await session.browserDriver.getPageState();

  if (!state) {
    return {
      content: [
        {
          type: "text" as const,
          text: error
            ? `Action failed: ${error}\n\nBrowser state could not be captured.`
            : "Browser state could not be captured.",
        },
      ],
    };
  }

  // Save screenshot
  const screenshotName = `explore_${Date.now()}.png`;
  const screenshotPath = join(session.artifactDir, screenshotName);
  await writeFile(screenshotPath, state.screenshot);

  // Mask DOM
  const maskedDom = session.masker.mask("dom_snapshot", state.dom) as string;

  // Build response
  const lines: string[] = [];
  if (error) {
    lines.push(`**Error:** ${error}`);
    lines.push("");
  }
  lines.push(`**URL:** ${state.url}`);
  lines.push(`**Title:** ${state.title}`);
  lines.push(`**Screenshot:** ${screenshotPath}`);
  lines.push("");
  lines.push("## DOM");
  lines.push("```html");
  lines.push(maskedDom);
  lines.push("```");

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}

async function executeHttpAction(
  session: ExplorationSession,
  httpConfig: z.infer<typeof HttpRequestConfigSchema>,
  extract?: Record<string, string>,
  timeoutMs?: number,
): Promise<{ content: { type: "text"; text: string }[] }> {
  // Build config with timeout override (don't expand variables - HttpDriver does it internally)
  const config = timeoutMs ? { ...httpConfig, timeout: timeoutMs } : httpConfig;

  // Build synthetic step for HttpDriver
  const syntheticStep: Step = {
    id: "explore_http",
    step_key: "explore_http",
    action: "http_request",
    config,
    extract,
    sort_order: 0,
  };

  const result = await session.httpDriver.execute(
    syntheticStep,
    session.variables
  );

  // Merge extracted values into session variables
  if (result.extractedValues) {
    Object.assign(session.variables, result.extractedValues);
  }

  // Build response
  const lines: string[] = [];

  if (result.errorMessage) {
    lines.push(`**Error:** ${result.errorMessage}`);
    lines.push("");
  }

  if (result.response) {
    lines.push(`**Status:** ${result.response.status}`);
    lines.push(`**Duration:** ${result.response.duration}ms`);
    lines.push("");

    // Headers
    lines.push("## Headers");
    lines.push("```");
    for (const [key, value] of Object.entries(result.response.headers)) {
      const maskedValue = session.masker.mask(
        "http_response",
        value
      ) as string;
      lines.push(`${key}: ${maskedValue}`);
    }
    lines.push("```");
    lines.push("");

    // Body
    const maskedBody = session.masker.mask(
      "http_response",
      result.response.body
    ) as string;
    lines.push("## Body");
    lines.push("```");
    lines.push(maskedBody);
    lines.push("```");
  }

  // Extracted values
  if (
    result.extractedValues &&
    Object.keys(result.extractedValues).length > 0
  ) {
    lines.push("");
    lines.push("## Extracted Values");
    for (const [key, value] of Object.entries(result.extractedValues)) {
      const maskedValue = session.masker.mask(
        "http_response",
        value
      ) as string;
      lines.push(`- ${key} = ${maskedValue}`);
    }
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}

async function executeBrowserAssertionAction(
  session: ExplorationSession,
  assertion: z.infer<typeof BrowserAssertionSchema>,
): Promise<{ content: { type: "text"; text: string }[] }> {
  if (!session.browserDriver) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Browser is not initialized. Execute a browser_step first (e.g., { goto: \"https://...\" }).",
        },
      ],
    };
  }

  // Expand variables in assertion
  const expandedAssertion = expandObject(assertion, session.variables);

  try {
    const result =
      await session.browserDriver.evaluateSingleAssertion(expandedAssertion);

    const icon = result.passed ? "PASS" : "FAIL";
    const lines: string[] = [`**[${icon}]** ${result.type}`];
    if (result.expected) lines.push(`**Expected:** ${result.expected}`);
    if (result.actual) lines.push(`**Actual:** ${result.actual}`);
    if (result.message) lines.push(`**Message:** ${result.message}`);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Assertion error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}
