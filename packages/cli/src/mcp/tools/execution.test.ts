import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerExecutionTools } from "./execution.js";
import type { AquaClient } from "../../api/client.js";
import * as environment from "../../environment/index.js";

vi.mock("../../environment/index.js", () => ({
  loadEnvironment: vi.fn(),
}));

// Shared mock execute function so tests can override return values
const mockExecute = vi.fn().mockResolvedValue({
  executionId: "exec1",
  executionUrl: "http://localhost:5173/executions/exec1",
  status: "completed",
  totalSteps: 1,
  passed: 1,
  failed: 0,
  errors: 0,
  skipped: 0,
  results: [
    {
      stepKey: "s1",
      scenarioName: "S1",
      action: "http_request",
      status: "passed",
      response: { status: 200, duration: 50 },
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  ],
  resolvedVariables: {},
});

// Mock QAPlanExecutor
vi.mock("../../driver/executor.js", () => {
  return {
    QAPlanExecutor: vi.fn(function () {
      return { execute: mockExecute };
    }),
  };
});

type ToolCallback = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const mockExtra = {
  _meta: {},
  sendNotification: vi.fn().mockResolvedValue(undefined),
  signal: new AbortController().signal,
};

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
    getHandler: (name: string) => {
      const handler = tools.get(name)!;
      return (args: Record<string, unknown>) => handler(args, mockExtra);
    },
  };
}

function createMockClient() {
  return {
    getQAPlan: vi.fn().mockResolvedValue({
      id: "p1",
      name: "Test Plan",
      url: "http://localhost:5173/qa-plans/p1",
      latest_version: {
        id: "pv1",
        version: 1,
        name: "v1",
        description: "",
        variables: {},
      },
    }),
    getQAPlanVersion: vi.fn(),
    getVersionScenarios: vi.fn().mockResolvedValue([
      {
        id: "sc1",
        name: "S1",
        sort_order: 0,
        steps: [
          {
            id: "sd1",
            step_key: "s1",
            action: "http_request",
            config: { method: "GET", url: "http://example.com" },
            sort_order: 0,
          },
        ],
      },
    ]),
    getExecution: vi.fn(),
    listStepExecutions: vi.fn(),
    listExecutions: vi.fn(),
  };
}

describe("execution tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    vi.mocked(environment.loadEnvironment).mockReset();
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({
      executionId: "exec1",
      executionUrl: "http://localhost:5173/executions/exec1",
      status: "completed",
      totalSteps: 1,
      passed: 1,
      failed: 0,
      errors: 0,
      skipped: 0,
      results: [
        {
          stepKey: "s1",
          scenarioName: "S1",
          action: "http_request",
          status: "passed",
          response: { status: 200, duration: 50 },
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      ],
      resolvedVariables: {},
    });
  });

  describe("execute_qa_plan", () => {
    it("executes plan with latest version", async () => {
      registerExecutionTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("execute_qa_plan")({
        qa_plan_id: "p1",
      });

      expect(result.content[0].text).toContain("Execution Result");
      expect(result.content[0].text).toContain("completed");
      expect(client.getVersionScenarios).toHaveBeenCalledWith("p1", 1);
    });

    it("includes execution URL in output", async () => {
      registerExecutionTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("execute_qa_plan")({
        qa_plan_id: "p1",
      });

      expect(result.content[0].text).toContain("**URL:** http://localhost:5173/executions/exec1");
    });

    it("returns error when plan has no versions", async () => {
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        name: "Empty Plan",
        latest_version: undefined,
      });
      registerExecutionTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("execute_qa_plan")({
        qa_plan_id: "p1",
      });

      expect(result.content[0].text).toContain("no versions");
    });

    it("loads environment when env_name provided", async () => {
      vi.mocked(environment.loadEnvironment).mockResolvedValue({
        variables: { api_base_url: "http://staging" },
        secretKeys: new Set(),
        secretValues: new Set(),
      });
      registerExecutionTools(server as never, client as unknown as AquaClient);

      await server.getHandler("execute_qa_plan")({
        qa_plan_id: "p1",
        env_name: "staging",
      });

      expect(environment.loadEnvironment).toHaveBeenCalledWith("staging", expect.any(Set));
    });

    it("includes variables section when resolvedVariables is non-empty", async () => {
      mockExecute.mockResolvedValueOnce({
        executionId: "exec1",
        executionUrl: "http://localhost:5173/executions/exec1",
        status: "completed",
        totalSteps: 0,
        passed: 0,
        failed: 0,
        errors: 0,
        skipped: 0,
        results: [],
        resolvedVariables: {
          api_base_url: "http://example.com",
          api_key: "***",
          timeout: "30",
        },
      });
      registerExecutionTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("execute_qa_plan")({
        qa_plan_id: "p1",
      });

      const text = result.content[0].text;
      expect(text).toContain("## Variables");
      expect(text).toContain("- api_base_url: http://example.com");
      expect(text).toContain("- api_key: ***");
      expect(text).toContain("- timeout: 30");
    });

    it("omits variables section when resolvedVariables is empty", async () => {
      registerExecutionTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("execute_qa_plan")({
        qa_plan_id: "p1",
      });

      expect(result.content[0].text).not.toContain("## Variables");
    });

    it("returns error on environment load failure", async () => {
      vi.mocked(environment.loadEnvironment).mockRejectedValue(
        new Error("Environment file not found")
      );
      registerExecutionTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("execute_qa_plan")({
        qa_plan_id: "p1",
        env_name: "nonexistent",
      });

      expect(result.content[0].text).toContain("Environment file not found");
    });
  });

  describe("get_execution", () => {
    it("returns execution with steps", async () => {
      client.getExecution.mockResolvedValue({
        id: "exec1",
        status: "completed",
      });
      client.listStepExecutions.mockResolvedValue([
        { id: "se1", step_key: "s1", status: "passed" },
      ]);
      registerExecutionTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("get_execution")({
        execution_id: "exec1",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.execution.id).toBe("exec1");
      expect(parsed.steps).toHaveLength(1);
    });
  });

  describe("list_executions", () => {
    it("returns execution list", async () => {
      client.listExecutions.mockResolvedValue({
        items: [{ id: "exec1", status: "completed" }],
        next_cursor: null,
      });
      registerExecutionTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("list_executions")({});

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.items).toHaveLength(1);
    });
  });
});
