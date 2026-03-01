import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerProgressTools } from "./progress.js";
import type { AquaClient } from "../../api/client.js";

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
    getExecution: vi.fn(),
    listStepExecutions: vi.fn(),
  };
}

describe("progress tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    registerProgressTools(
      server as never,
      client as unknown as AquaClient
    );
  });

  it("registers get_execution_progress tool", () => {
    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.getHandler("get_execution_progress")).toBeDefined();
  });

  describe("get_execution_progress", () => {
    it("shows progress for a running execution", async () => {
      client.getExecution.mockResolvedValue({
        id: "exec-1",
        status: "running",
        url: "https://app.aquaqa.com/executions/exec-1",
      });
      client.listStepExecutions.mockResolvedValue([
        {
          step_key: "login",
          action: "browser",
          status: "passed",
          scenario_name: "Auth",
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:00:02Z",
        },
        {
          step_key: "check-dashboard",
          action: "browser",
          status: "running",
          scenario_name: "Auth",
        },
      ]);

      const result = await server.getHandler("get_execution_progress")({
        execution_id: "exec-1",
      });
      const text = result.content[0].text;

      expect(text).toContain("exec-1");
      expect(text).toContain("running");
      expect(text).toContain("1 / 2 steps completed");
      expect(text).toContain("check-dashboard");
      expect(text).toContain("[PASS]");
      expect(text).toContain("2000ms");
    });

    it("shows completed execution summary", async () => {
      client.getExecution.mockResolvedValue({
        id: "exec-2",
        status: "completed",
        url: "https://app.aquaqa.com/executions/exec-2",
      });
      client.listStepExecutions.mockResolvedValue([
        {
          step_key: "step-1",
          action: "http_request",
          status: "passed",
          scenario_name: "API",
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:00:01Z",
        },
        {
          step_key: "step-2",
          action: "http_request",
          status: "failed",
          scenario_name: "API",
          error_message: "Expected 200 but got 500",
          started_at: "2026-01-01T00:00:01Z",
          finished_at: "2026-01-01T00:00:02Z",
        },
      ]);

      const result = await server.getHandler("get_execution_progress")({
        execution_id: "exec-2",
      });
      const text = result.content[0].text;

      expect(text).toContain("completed");
      expect(text).toContain("Passed: 1");
      expect(text).toContain("Failed: 1");
      expect(text).toContain("[FAIL]");
      expect(text).toContain("Expected 200 but got 500");
    });

    it("groups steps by scenario name", async () => {
      client.getExecution.mockResolvedValue({
        id: "exec-3",
        status: "completed",
        url: "https://app.aquaqa.com/executions/exec-3",
      });
      client.listStepExecutions.mockResolvedValue([
        {
          step_key: "s1",
          action: "browser",
          status: "passed",
          scenario_name: "Login",
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:00:01Z",
        },
        {
          step_key: "s2",
          action: "http_request",
          status: "passed",
          scenario_name: "API Check",
          started_at: "2026-01-01T00:00:01Z",
          finished_at: "2026-01-01T00:00:02Z",
        },
      ]);

      const result = await server.getHandler("get_execution_progress")({
        execution_id: "exec-3",
      });
      const text = result.content[0].text;

      expect(text).toContain("### Login");
      expect(text).toContain("### API Check");
    });

    it("shows skipped and error counts", async () => {
      client.getExecution.mockResolvedValue({
        id: "exec-4",
        status: "completed",
        url: "https://app.aquaqa.com/executions/exec-4",
      });
      client.listStepExecutions.mockResolvedValue([
        {
          step_key: "s1",
          action: "browser",
          status: "error",
          scenario_name: "Flow",
          error_message: "Timeout",
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:00:10Z",
        },
        {
          step_key: "s2",
          action: "browser",
          status: "skipped",
          scenario_name: "Flow",
        },
      ]);

      const result = await server.getHandler("get_execution_progress")({
        execution_id: "exec-4",
      });
      const text = result.content[0].text;

      expect(text).toContain("Errors: 1");
      expect(text).toContain("Skipped: 1");
      expect(text).toContain("[ERROR]");
      expect(text).toContain("[SKIP]");
    });
  });
});
