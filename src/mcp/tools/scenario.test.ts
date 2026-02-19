import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerScenarioTools } from "./scenario.js";
import type { AquaClient } from "../../api/client.js";
import * as environment from "../../environment/index.js";

vi.mock("../../environment/index.js", () => ({
  loadEnvironment: vi.fn(),
}));

const mockRun = vi.fn();

vi.mock("../../driver/scenario-runner.js", () => {
  return {
    ScenarioRunner: vi.fn(function () {
      return { run: mockRun };
    }),
  };
});

type ToolCallback = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function createMockServer() {
  const tools = new Map<string, ToolCallback>();
  return {
    tool: vi.fn(
      (
        name: string,
        _desc: string,
        _schema: unknown,
        handler: ToolCallback
      ) => {
        tools.set(name, handler);
      }
    ),
    getHandler: (name: string) => tools.get(name)!,
  };
}

function createMockClient() {
  return {
    getQAPlan: vi.fn().mockResolvedValue({
      id: "p1",
      name: "Test Plan",
      latest_version: {
        id: "pv1",
        version: 1,
        name: "v1",
        variables: { api_base_url: "http://plan-default" },
      },
    }),
    getQAPlanVersion: vi.fn().mockResolvedValue({
      id: "pv2",
      version: 2,
      name: "v2",
      variables: { api_base_url: "http://v2-default" },
    }),
  };
}

function defaultRunResult(overrides?: Record<string, unknown>) {
  return {
    status: "passed",
    totalSteps: 1,
    passed: 1,
    failed: 0,
    errors: 0,
    skipped: 0,
    results: [
      {
        stepKey: "step1",
        scenarioName: "Test",
        action: "http_request",
        status: "passed",
        response: { status: 200, body: '{"ok":true}', duration: 50, headers: {} },
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    ],
    resolvedVariables: {},
    ...overrides,
  };
}

describe("scenario tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    vi.mocked(environment.loadEnvironment).mockReset();
    mockRun.mockReset();
    mockRun.mockResolvedValue(defaultRunResult());
  });

  it("registers run_scenario tool", () => {
    registerScenarioTools(server as never, client as unknown as AquaClient);
    expect(server.tool).toHaveBeenCalledWith(
      "run_scenario",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("executes scenario and returns formatted result", async () => {
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Test Scenario",
        steps: [
          {
            step_key: "step1",
            action: "http_request",
            config: { method: "GET", url: "http://example.com" },
          },
        ],
      },
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("# Scenario Result: Test Scenario");
    expect(text).toContain("**Status:** passed");
    expect(text).toContain("[PASS] step1");
  });

  it("includes HTTP response body in output", async () => {
    mockRun.mockResolvedValue(defaultRunResult({
      results: [
        {
          stepKey: "step1",
          scenarioName: "Test",
          action: "http_request",
          status: "passed",
          response: {
            status: 200,
            body: '{"user":"alice"}',
            duration: 30,
            headers: {},
          },
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      ],
    }));
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "http_request", config: { method: "GET", url: "http://example.com" } }],
      },
    });

    expect(result.content[0].text).toContain('{"user":"alice"}');
  });

  it("shows assertion results in output", async () => {
    mockRun.mockResolvedValue(defaultRunResult({
      status: "failed",
      failed: 1,
      passed: 0,
      results: [
        {
          stepKey: "step1",
          scenarioName: "Test",
          action: "http_request",
          status: "failed",
          response: { status: 500, body: "{}", duration: 10, headers: {} },
          assertionResults: [
            { type: "status_code", expected: "200", actual: "500", passed: false },
          ],
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      ],
    }));
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [
          {
            step_key: "step1",
            action: "http_request",
            config: { method: "GET", url: "http://example.com" },
            assertions: [{ type: "status_code", expected: 200 }],
          },
        ],
      },
    });

    const text = result.content[0].text;
    expect(text).toContain("[FAIL] step1");
    expect(text).toContain("[FAIL] status_code");
    expect(text).toContain("expected=200");
    expect(text).toContain("actual=500");
  });

  it("pulls plan variables when qa_plan_id is provided", async () => {
    registerScenarioTools(server as never, client as unknown as AquaClient);

    await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "http_request", config: { method: "GET", url: "http://example.com" } }],
      },
      qa_plan_id: "p1",
    });

    expect(client.getQAPlan).toHaveBeenCalledWith("p1");
    // ScenarioRunner.run is called with variables from plan
    const runArgs = mockRun.mock.calls[0];
    const variables = runArgs[1];
    expect(variables.api_base_url).toBe("http://plan-default");
  });

  it("uses specific version when version is provided", async () => {
    registerScenarioTools(server as never, client as unknown as AquaClient);

    await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "http_request", config: { method: "GET", url: "http://example.com" } }],
      },
      qa_plan_id: "p1",
      version: 2,
    });

    expect(client.getQAPlanVersion).toHaveBeenCalledWith("p1", 2);
    const variables = mockRun.mock.calls[0][1];
    expect(variables.api_base_url).toBe("http://v2-default");
  });

  it("overrides plan variables with environment and inline overrides", async () => {
    vi.mocked(environment.loadEnvironment).mockResolvedValue({
      variables: { api_base_url: "http://env-value", env_only: "from-env" },
      secretKeys: new Set(),
      secretValues: new Set(),
    });
    registerScenarioTools(server as never, client as unknown as AquaClient);

    await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "http_request", config: { method: "GET", url: "http://example.com" } }],
      },
      qa_plan_id: "p1",
      env_name: "staging",
      environment: { api_base_url: "http://override" },
    });

    const variables = mockRun.mock.calls[0][1];
    expect(variables.api_base_url).toBe("http://override");
    expect(variables.env_only).toBe("from-env");
  });

  it("loads environment when env_name is provided", async () => {
    vi.mocked(environment.loadEnvironment).mockResolvedValue({
      variables: { api_base_url: "http://staging" },
      secretKeys: new Set(),
      secretValues: new Set(),
    });
    registerScenarioTools(server as never, client as unknown as AquaClient);

    await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "http_request", config: { method: "GET", url: "http://example.com" } }],
      },
      env_name: "staging",
    });

    expect(environment.loadEnvironment).toHaveBeenCalledWith("staging", expect.any(Set));
  });

  it("returns error when environment loading fails", async () => {
    vi.mocked(environment.loadEnvironment).mockRejectedValue(
      new Error("Environment file not found")
    );
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "http_request", config: { method: "GET", url: "http://example.com" } }],
      },
      env_name: "nonexistent",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Environment file not found");
  });

  it("returns error when plan loading fails", async () => {
    client.getQAPlan.mockRejectedValue(new Error("Plan not found"));
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "http_request", config: { method: "GET", url: "http://example.com" } }],
      },
      qa_plan_id: "nonexistent",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Plan not found");
  });

  it("returns error when runner throws", async () => {
    mockRun.mockRejectedValue(new Error("Playwright is not installed"));
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "browser", config: { steps: [{ goto: "http://example.com" }] } }],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Playwright is not installed");
  });

  it("shows extracted values in output", async () => {
    mockRun.mockResolvedValue(defaultRunResult({
      results: [
        {
          stepKey: "login",
          scenarioName: "Test",
          action: "http_request",
          status: "passed",
          response: { status: 200, body: '{"token":"abc"}', duration: 10, headers: {} },
          extractedValues: { auth_token: "abc" },
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      ],
    }));
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [
          {
            step_key: "login",
            action: "http_request",
            config: { method: "POST", url: "http://example.com/login" },
            extract: { auth_token: "$.token" },
          },
        ],
      },
    });

    const text = result.content[0].text;
    expect(text).toContain("### Extracted Values");
    expect(text).toContain("auth_token");
  });

  it("shows variables after execution", async () => {
    mockRun.mockResolvedValue(defaultRunResult({
      resolvedVariables: { api_base_url: "http://example.com", api_key: "***" },
    }));
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Test",
        steps: [{ step_key: "step1", action: "http_request", config: { method: "GET", url: "http://example.com" } }],
      },
    });

    const text = result.content[0].text;
    expect(text).toContain("## Variables After Execution");
    expect(text).toContain("api_base_url: http://example.com");
    expect(text).toContain("api_key: ***");
  });

  it("works without qa_plan_id or env_name (minimal usage)", async () => {
    registerScenarioTools(server as never, client as unknown as AquaClient);

    const result = await server.getHandler("run_scenario")({
      scenario: {
        name: "Quick Test",
        steps: [
          {
            step_key: "health",
            action: "http_request",
            config: { method: "GET", url: "http://localhost:3000/health" },
            assertions: [{ type: "status_code", expected: 200 }],
          },
        ],
      },
    });

    expect(result.isError).toBeUndefined();
    expect(client.getQAPlan).not.toHaveBeenCalled();
    expect(environment.loadEnvironment).not.toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalled();
  });
});
