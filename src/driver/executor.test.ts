import { describe, it, expect, vi, beforeEach } from "vitest";
import { QAPlanExecutor } from "./executor.js";
import type { AquaClient } from "../api/client.js";
import type { QAPlanData, StepResult } from "../qa-plan/types.js";
import type { ResolvedEnvironment } from "../environment/index.js";

// Mock browser driver and step-utils to avoid Playwright dependency
vi.mock("./browser.js", () => {
  return {
    BrowserDriver: vi.fn().mockImplementation(() => ({
      execute: vi.fn(),
      getStorageState: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});
vi.mock("./step-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./step-utils.js")>();
  return {
    ...original,
    checkBrowserDependencies: vi.fn().mockResolvedValue(undefined),
  };
});

function createMockClient(): AquaClient & {
  createExecution: ReturnType<typeof vi.fn>;
  updateExecution: ReturnType<typeof vi.fn>;
  createStepExecution: ReturnType<typeof vi.fn>;
  updateStepExecution: ReturnType<typeof vi.fn>;
  uploadArtifact: ReturnType<typeof vi.fn>;
  createAssertionResults: ReturnType<typeof vi.fn>;
} {
  return {
    createExecution: vi.fn().mockResolvedValue({ id: "exec1", url: "http://localhost:5173/executions/exec1" }),
    updateExecution: vi.fn().mockResolvedValue({}),
    createStepExecution: vi.fn().mockResolvedValue({ id: "se1" }),
    updateStepExecution: vi.fn().mockResolvedValue({}),
    uploadArtifact: vi.fn().mockResolvedValue({ id: "art1" }),
    createAssertionResults: vi.fn().mockResolvedValue([]),
  } as unknown as AquaClient & {
    createExecution: ReturnType<typeof vi.fn>;
    updateExecution: ReturnType<typeof vi.fn>;
    createStepExecution: ReturnType<typeof vi.fn>;
    updateStepExecution: ReturnType<typeof vi.fn>;
    uploadArtifact: ReturnType<typeof vi.fn>;
    createAssertionResults: ReturnType<typeof vi.fn>;
  };
}

const minimalPlan: QAPlanData = {
  name: "Test Plan",
  scenarios: [
    {
      id: "sc1",
      name: "Scenario 1",
      sort_order: 0,
      steps: [
        {
          id: "sd1",
          step_key: "step1",
          action: "http_request",
          config: {
            method: "GET",
            url: "http://example.com/api",
          },
          sort_order: 0,
        },
      ],
    },
  ],
};

describe("QAPlanExecutor", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("executes a single scenario and returns completed", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const client = createMockClient();
    const executor = new QAPlanExecutor(client);
    const summary = await executor.execute(minimalPlan, "pv1");

    expect(summary.status).toBe("completed");
    expect(summary.executionUrl).toBe("http://localhost:5173/executions/exec1");
    expect(summary.totalSteps).toBe(1);
    expect(summary.passed).toBe(1);
    expect(client.createExecution).toHaveBeenCalledWith({
      qa_plan_version_id: "pv1",
      environment: undefined,
    });
    expect(client.updateExecution).toHaveBeenCalledWith("exec1", {
      status: "completed",
    });
  });

  it("merges variables with correct priority", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve("{}"),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const plan: QAPlanData = {
      ...minimalPlan,
      variables: { api_base_url: "http://plan-default", env_var: "from-plan" },
    };
    const resolvedEnv: ResolvedEnvironment = {
      variables: { api_base_url: "http://env-file", env_var: "from-env" },
      secretKeys: new Set(),
      secretValues: new Set(),
    };

    const client = createMockClient();
    const executor = new QAPlanExecutor(client);
    await executor.execute(plan, "pv1", { api_base_url: "http://override" }, resolvedEnv);

    // Verify environment layers are sent with correct priority
    expect(client.createExecution).toHaveBeenCalledWith({
      qa_plan_version_id: "pv1",
      environment: {
        layers: [
          { type: "qa_plan", variables: { api_base_url: "http://plan-default", env_var: "from-plan" } },
          { type: "environment", name: undefined, variables: { api_base_url: "http://env-file", env_var: "from-env" } },
          { type: "override", variables: { api_base_url: "http://override" } },
        ],
      },
    });
  });

  it("masks secrets in environment before sending", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve("{}"),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const resolvedEnv: ResolvedEnvironment = {
      variables: { api_key: "my-secret", api_base_url: "http://example.com" },
      secretKeys: new Set(["api_key"]),
      secretValues: new Set(["my-secret"]),
    };

    const client = createMockClient();
    const executor = new QAPlanExecutor(client);
    await executor.execute(minimalPlan, "pv1", undefined, resolvedEnv);

    const envArg = client.createExecution.mock.calls[0][0].environment;
    const layer = envArg.layers[0];
    expect(layer.variables.api_key).toBe("***");
    expect(layer.variables.api_base_url).toBe("http://example.com");
  });

  it("reports failed status when assertion fails", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 500,
      text: () => Promise.resolve("{}"),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const plan: QAPlanData = {
      name: "Test",
      scenarios: [
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
              assertions: [{ type: "status_code", expected: 200 }],
              sort_order: 0,
            },
          ],
        },
      ],
    };

    const client = createMockClient();
    const executor = new QAPlanExecutor(client);
    const summary = await executor.execute(plan, "pv1");

    expect(summary.status).toBe("failed");
    expect(summary.failed).toBe(1);
    expect(client.updateExecution).toHaveBeenCalledWith("exec1", {
      status: "failed",
    });
  });

  it("skips step when dependency not met", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 500,
      text: () => Promise.resolve("{}"),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const plan: QAPlanData = {
      name: "Test",
      scenarios: [
        {
          id: "sc1",
          name: "S1",
          sort_order: 0,
          steps: [
            {
              id: "sd1",
              step_key: "login",
              action: "http_request",
              config: { method: "POST", url: "http://example.com/login" },
              assertions: [{ type: "status_code", expected: 200 }],
              sort_order: 0,
            },
            {
              id: "sd2",
              step_key: "get-data",
              action: "http_request",
              depends_on: ["login"],
              config: { method: "GET", url: "http://example.com/data" },
              sort_order: 1,
            },
          ],
        },
      ],
    };

    const client = createMockClient();
    const executor = new QAPlanExecutor(client);
    const summary = await executor.execute(plan, "pv1");

    expect(summary.skipped).toBe(1);
    expect(summary.results[1].status).toBe("skipped");
  });

  it("continues when artifact upload fails", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const client = createMockClient();
    client.uploadArtifact.mockRejectedValue(new Error("upload failed"));
    const executor = new QAPlanExecutor(client);
    const summary = await executor.execute(minimalPlan, "pv1");

    expect(summary.status).toBe("completed");
    expect(summary.passed).toBe(1);
  });

  it("continues when assertion report fails", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve("{}"),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const plan: QAPlanData = {
      name: "Test",
      scenarios: [
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
              assertions: [{ type: "status_code", expected: 200 }],
              sort_order: 0,
            },
          ],
        },
      ],
    };

    const client = createMockClient();
    client.createAssertionResults.mockRejectedValue(
      new Error("assertion report failed")
    );
    const executor = new QAPlanExecutor(client);
    const summary = await executor.execute(plan, "pv1");

    expect(summary.status).toBe("completed");
  });

  it("reports error status on execution failure", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const client = createMockClient();
    const executor = new QAPlanExecutor(client);
    const summary = await executor.execute(minimalPlan, "pv1");

    expect(summary.status).toBe("error");
    expect(summary.errors).toBe(1);
  });

  it("calls onExecutionCreated callback after creating execution", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const client = createMockClient();
    const executor = new QAPlanExecutor(client);
    const onCreated = vi.fn();
    await executor.execute(minimalPlan, "pv1", undefined, undefined, undefined, onCreated);

    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith("exec1", "http://localhost:5173/executions/exec1");
  });

  it("does not fail when onExecutionCreated is omitted", async () => {
    const headers = new Map([["content-type", "application/json"]]);
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    });

    const client = createMockClient();
    const executor = new QAPlanExecutor(client);
    const summary = await executor.execute(minimalPlan, "pv1");

    expect(summary.status).toBe("completed");
  });

  describe("cross-scenario depends_on", () => {
    it("resolves dependencies from previous scenarios", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const plan: QAPlanData = {
        name: "Cross-scenario test",
        scenarios: [
          {
            id: "sc1",
            name: "Setup",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "setup_step",
                action: "http_request",
                config: { method: "POST", url: "http://example.com/setup" },
                sort_order: 0,
              },
            ],
          },
          {
            id: "sc2",
            name: "Verify",
            sort_order: 1,
            steps: [
              {
                id: "sd2",
                step_key: "verify_step",
                action: "http_request",
                depends_on: ["setup_step"],
                config: { method: "GET", url: "http://example.com/verify" },
                sort_order: 0,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      expect(summary.status).toBe("completed");
      expect(summary.passed).toBe(2);
      expect(summary.skipped).toBe(0);
    });

    it("skips step when cross-scenario dependency failed", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 500,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const plan: QAPlanData = {
        name: "Cross-scenario fail test",
        scenarios: [
          {
            id: "sc1",
            name: "Setup",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "setup_step",
                action: "http_request",
                config: { method: "POST", url: "http://example.com/setup" },
                assertions: [{ type: "status_code", expected: 200 }],
                sort_order: 0,
              },
            ],
          },
          {
            id: "sc2",
            name: "Verify",
            sort_order: 1,
            steps: [
              {
                id: "sd2",
                step_key: "verify_step",
                action: "http_request",
                depends_on: ["setup_step"],
                config: { method: "GET", url: "http://example.com/verify" },
                sort_order: 0,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      expect(summary.failed).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(summary.results[1].status).toBe("skipped");
      expect(summary.results[1].errorMessage).toBe("Dependency not met");
    });
  });

  describe("proxy support", () => {
    it("sends masked proxy config to server when proxy is configured", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const resolvedEnv: ResolvedEnvironment = {
        variables: { api_url: "http://example.com" },
        secretKeys: new Set(),
        secretValues: new Set(["proxy-secret-pass"]),
        proxy: {
          server: "http://proxy:3128",
          bypass: "localhost",
          username: "proxyuser",
          password: "proxy-secret-pass",
        },
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      await executor.execute(minimalPlan, "pv1", undefined, resolvedEnv);

      const envArg = client.createExecution.mock.calls[0][0].environment;
      expect(envArg.proxy).toEqual({
        server: "http://proxy:3128",
        bypass: "localhost",
        username: "***",
        password: "***",
      });
    });

    it("sends proxy with server only (no auth)", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const resolvedEnv: ResolvedEnvironment = {
        variables: {},
        secretKeys: new Set(),
        secretValues: new Set(),
        proxy: {
          server: "http://proxy:3128",
        },
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      await executor.execute(minimalPlan, "pv1", undefined, resolvedEnv);

      const envArg = client.createExecution.mock.calls[0][0].environment;
      expect(envArg.proxy).toEqual({
        server: "http://proxy:3128",
        bypass: undefined,
        username: undefined,
        password: undefined,
      });
    });

    it("does not send proxy when not configured", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      await executor.execute(minimalPlan, "pv1");

      expect(client.createExecution).toHaveBeenCalledWith({
        qa_plan_version_id: "pv1",
        environment: undefined,
      });
    });
  });

  describe("resolvedVariables in summary", () => {
    it("returns empty resolvedVariables when no variables provided", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(minimalPlan, "pv1");

      expect(summary.resolvedVariables).toEqual({});
    });

    it("returns merged resolvedVariables from all layers", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const plan: QAPlanData = {
        ...minimalPlan,
        variables: { api_base_url: "http://plan-default", timeout: "30" },
      };
      const resolvedEnv: ResolvedEnvironment = {
        variables: { api_base_url: "http://env-file" },
        secretKeys: new Set(),
        secretValues: new Set(),
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(
        plan, "pv1",
        { api_base_url: "http://override" },
        resolvedEnv
      );

      expect(summary.resolvedVariables).toEqual({
        api_base_url: "http://override",
        timeout: "30",
      });
    });

    it("returns masked values for secrets in resolvedVariables", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const resolvedEnv: ResolvedEnvironment = {
        variables: { api_key: "my-secret", api_base_url: "http://example.com" },
        secretKeys: new Set(["api_key"]),
        secretValues: new Set(["my-secret"]),
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(minimalPlan, "pv1", undefined, resolvedEnv);

      expect(summary.resolvedVariables.api_key).toBe("***");
      expect(summary.resolvedVariables.api_base_url).toBe("http://example.com");
    });
  });

  describe("scenario requires", () => {
    it("skips entire scenario when required variables are missing", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const plan: QAPlanData = {
        name: "Test",
        scenarios: [
          {
            id: "sc1",
            name: "API Tests",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "api_test",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/api" },
                sort_order: 0,
              },
            ],
          },
          {
            id: "sc2",
            name: "DB Tests",
            requires: ["db_url", "db_password"],
            sort_order: 1,
            steps: [
              {
                id: "sd2",
                step_key: "db_check",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/db/check" },
                sort_order: 0,
              },
              {
                id: "sd3",
                step_key: "db_verify",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/db/verify" },
                sort_order: 1,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      expect(summary.status).toBe("completed");
      expect(summary.passed).toBe(1);
      expect(summary.skipped).toBe(2);
      expect(summary.results[1].status).toBe("skipped");
      expect(summary.results[1].errorMessage).toContain("Missing required variable(s)");
      expect(summary.results[1].errorMessage).toContain("db_url");
      expect(summary.results[1].errorMessage).toContain("db_password");
      expect(summary.results[2].status).toBe("skipped");
    });

    it("executes scenario when all required variables are present", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const plan: QAPlanData = {
        name: "Test",
        variables: { db_url: "postgres://localhost/test" },
        scenarios: [
          {
            id: "sc1",
            name: "DB Tests",
            requires: ["db_url"],
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "db_check",
                action: "http_request",
                config: { method: "GET", url: "http://example.com" },
                sort_order: 0,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      expect(summary.status).toBe("completed");
      expect(summary.passed).toBe(1);
      expect(summary.skipped).toBe(0);
    });

    it("skips only some missing variables", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const plan: QAPlanData = {
        name: "Test",
        variables: { db_url: "postgres://localhost/test" },
        scenarios: [
          {
            id: "sc1",
            name: "DB Tests",
            requires: ["db_url", "db_password"],
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "db_check",
                action: "http_request",
                config: { method: "GET", url: "http://example.com" },
                sort_order: 0,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      expect(summary.skipped).toBe(1);
      expect(summary.results[0].errorMessage).toContain("db_password");
      expect(summary.results[0].errorMessage).not.toContain("db_url");
    });

    it("checks requires against current variables including extracted values", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('{"connection":"postgres://db"}'),
            headers: {
              forEach: (cb: (v: string, k: string) => void) =>
                headers.forEach((v, k) => cb(v, k)),
            },
          });
        }
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve("{}"),
          headers: {
            forEach: (cb: (v: string, k: string) => void) =>
              headers.forEach((v, k) => cb(v, k)),
          },
        });
      });

      const plan: QAPlanData = {
        name: "Test",
        scenarios: [
          {
            id: "sc1",
            name: "Setup",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "get_db_url",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/config" },
                extract: { db_url: "$.connection" },
                sort_order: 0,
              },
            ],
          },
          {
            id: "sc2",
            name: "DB Tests",
            requires: ["db_url"],
            sort_order: 1,
            steps: [
              {
                id: "sd2",
                step_key: "db_check",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/db" },
                sort_order: 0,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      // db_url was extracted in first scenario, so second scenario should execute
      expect(summary.status).toBe("completed");
      expect(summary.passed).toBe(2);
      expect(summary.skipped).toBe(0);
    });

    it("does not skip scenario without requires field", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const plan: QAPlanData = {
        name: "Test",
        scenarios: [
          {
            id: "sc1",
            name: "Normal",
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
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      expect(summary.passed).toBe(1);
      expect(summary.skipped).toBe(0);
    });
  });

  describe("cross-scenario variable sharing", () => {
    it("shares extracted variables across scenarios", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            status: 201,
            text: () => Promise.resolve('{"id":"extracted-123"}'),
            headers: {
              forEach: (cb: (v: string, k: string) => void) =>
                headers.forEach((v, k) => cb(v, k)),
            },
          });
        }
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve("{}"),
          headers: {
            forEach: (cb: (v: string, k: string) => void) =>
              headers.forEach((v, k) => cb(v, k)),
          },
        });
      });

      const plan: QAPlanData = {
        name: "Variable sharing test",
        scenarios: [
          {
            id: "sc1",
            name: "Create",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "create_item",
                action: "http_request",
                config: { method: "POST", url: "http://example.com/items" },
                extract: { item_id: "$.id" },
                sort_order: 0,
              },
            ],
          },
          {
            id: "sc2",
            name: "Verify",
            sort_order: 1,
            steps: [
              {
                id: "sd2",
                step_key: "get_item",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/items/{{item_id}}" },
                sort_order: 0,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      expect(summary.status).toBe("completed");
      expect(summary.passed).toBe(2);
      // Verify the second fetch was called with the extracted variable
      expect(mockFetch.mock.calls[1][0]).toBe("http://example.com/items/extracted-123");
    });
  });

  describe("abortScenario on navigation failure", () => {
    it("skips remaining steps when browser step returns abortScenario", async () => {
      const { BrowserDriver } = await import("./browser.js");
      const mockExecute = vi.fn().mockResolvedValue({
        stepKey: "goto_page",
        scenarioName: "",
        action: "browser",
        status: "error",
        errorMessage: "Navigation timeout",
        abortScenario: true,
        startedAt: new Date(),
        finishedAt: new Date(),
      } satisfies StepResult);

      vi.mocked(BrowserDriver).mockImplementation(function () {
        return {
          execute: mockExecute,
          getStorageState: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        };
      } as never);

      const plan: QAPlanData = {
        name: "Abort test",
        scenarios: [
          {
            id: "sc1",
            name: "Browser scenario",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "goto_page",
                action: "browser",
                config: { steps: [{ goto: "http://unreachable.test" }] },
                sort_order: 0,
              },
              {
                id: "sd2",
                step_key: "click_button",
                action: "browser",
                config: { steps: [{ click: "#submit" }] },
                sort_order: 1,
              },
              {
                id: "sd3",
                step_key: "verify",
                action: "browser",
                config: { steps: [{ wait_for_selector: ".success" }] },
                sort_order: 2,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      expect(summary.errors).toBe(1);
      expect(summary.skipped).toBe(2);
      expect(summary.results[0].status).toBe("error");
      expect(summary.results[0].abortScenario).toBe(true);
      expect(summary.results[1].status).toBe("skipped");
      expect(summary.results[1].errorMessage).toBe("Scenario aborted due to navigation failure");
      expect(summary.results[2].status).toBe("skipped");
      expect(summary.results[2].errorMessage).toBe("Scenario aborted due to navigation failure");
      // BrowserDriver.execute should only be called once (for the first step)
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("reports skipped steps to server on abort", async () => {
      const { BrowserDriver } = await import("./browser.js");
      vi.mocked(BrowserDriver).mockImplementation(function () {
        return {
          execute: vi.fn().mockResolvedValue({
            stepKey: "goto_page",
            scenarioName: "",
            action: "browser",
            status: "error",
            errorMessage: "Navigation timeout",
            abortScenario: true,
            startedAt: new Date(),
            finishedAt: new Date(),
          } satisfies StepResult),
          getStorageState: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        };
      } as never);

      const plan: QAPlanData = {
        name: "Abort test",
        scenarios: [
          {
            id: "sc1",
            name: "S1",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "goto_page",
                action: "browser",
                config: { steps: [{ goto: "http://unreachable.test" }] },
                sort_order: 0,
              },
              {
                id: "sd2",
                step_key: "next_step",
                action: "browser",
                config: { steps: [{ click: "#btn" }] },
                sort_order: 1,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      await executor.execute(plan, "pv1");

      // First step: createStepExecution (running) + updateStepExecution (error)
      // Second step: createStepExecution (skipped) via reportStep
      expect(client.createStepExecution).toHaveBeenCalledTimes(2);
      const skippedCall = client.createStepExecution.mock.calls[1][1];
      expect(skippedCall.status).toBe("skipped");
      expect(skippedCall.error_message).toBe("Scenario aborted due to navigation failure");
    });

    it("continues next scenario after aborting current one", async () => {
      const { BrowserDriver } = await import("./browser.js");
      vi.mocked(BrowserDriver).mockImplementation(function () {
        return {
          execute: vi.fn().mockResolvedValue({
            stepKey: "",
            scenarioName: "",
            action: "browser",
            status: "error",
            errorMessage: "Navigation timeout",
            abortScenario: true,
            startedAt: new Date(),
            finishedAt: new Date(),
          } satisfies StepResult),
          getStorageState: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        };
      } as never);

      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve("{}"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const plan: QAPlanData = {
        name: "Multi-scenario abort test",
        scenarios: [
          {
            id: "sc1",
            name: "Browser scenario",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "goto_page",
                action: "browser",
                config: { steps: [{ goto: "http://unreachable.test" }] },
                sort_order: 0,
              },
              {
                id: "sd2",
                step_key: "after_goto",
                action: "browser",
                config: { steps: [{ click: "#btn" }] },
                sort_order: 1,
              },
            ],
          },
          {
            id: "sc2",
            name: "HTTP scenario",
            sort_order: 1,
            steps: [
              {
                id: "sd3",
                step_key: "api_call",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/api" },
                sort_order: 0,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      // Scenario 1: 1 error + 1 skipped, Scenario 2: 1 passed
      expect(summary.errors).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(summary.passed).toBe(1);
      expect(summary.results[2].status).toBe("passed");
    });

    it("does not abort when step fails without abortScenario flag", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));

      const plan: QAPlanData = {
        name: "Non-abort test",
        scenarios: [
          {
            id: "sc1",
            name: "S1",
            sort_order: 0,
            steps: [
              {
                id: "sd1",
                step_key: "step1",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/a" },
                sort_order: 0,
              },
              {
                id: "sd2",
                step_key: "step2",
                action: "http_request",
                config: { method: "GET", url: "http://example.com/b" },
                sort_order: 1,
              },
            ],
          },
        ],
      };

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(plan, "pv1");

      // Both steps should be executed (both error, not aborted)
      expect(summary.errors).toBe(2);
      expect(summary.skipped).toBe(0);
    });
  });

  describe("skipRecording", () => {
    it("skips all server API calls when skipRecording is true", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('{"ok":true}'),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(
        minimalPlan, "pv1", undefined, undefined, undefined, undefined, undefined, true
      );

      expect(summary.status).toBe("completed");
      expect(summary.recorded).toBe(false);
      expect(summary.executionId).toBe("(not recorded)");
      expect(summary.executionUrl).toBe("");

      // No server API calls should have been made
      expect(client.createExecution).not.toHaveBeenCalled();
      expect(client.updateExecution).not.toHaveBeenCalled();
      expect(client.createStepExecution).not.toHaveBeenCalled();
      expect(client.updateStepExecution).not.toHaveBeenCalled();
      expect(client.uploadArtifact).not.toHaveBeenCalled();
      expect(client.createAssertionResults).not.toHaveBeenCalled();
    });

    it("still executes test steps when skipRecording is true", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 500,
        text: () => Promise.resolve("Server Error"),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(
        minimalPlan, "pv1", undefined, undefined, undefined, undefined, undefined, true
      );

      // Test should still run and detect the failure
      expect(summary.totalSteps).toBe(1);
      expect(summary.recorded).toBe(false);
    });

    it("records to server when skipRecording is false", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('{"ok":true}'),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(
        minimalPlan, "pv1", undefined, undefined, undefined, undefined, undefined, false
      );

      expect(summary.recorded).toBe(true);
      expect(client.createExecution).toHaveBeenCalled();
      expect(client.updateExecution).toHaveBeenCalled();
      expect(client.createStepExecution).toHaveBeenCalled();
    });

    it("sets recorded to true by default", async () => {
      const headers = new Map([["content-type", "application/json"]]);
      mockFetch.mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('{"ok":true}'),
        headers: {
          forEach: (cb: (v: string, k: string) => void) =>
            headers.forEach((v, k) => cb(v, k)),
        },
      });

      const client = createMockClient();
      const executor = new QAPlanExecutor(client);
      const summary = await executor.execute(minimalPlan, "pv1");

      expect(summary.recorded).toBe(true);
    });
  });
});
