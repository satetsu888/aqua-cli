import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeQAPlan } from "./execute.js";
import type { AquaClient } from "../api/client.js";
import * as environment from "../environment/index.js";

vi.mock("../environment/index.js", () => ({
  loadEnvironment: vi.fn(),
  listEnvironments: vi.fn(),
}));

const mockExecute = vi.fn();

vi.mock("../driver/executor.js", () => {
  return {
    QAPlanExecutor: vi.fn(function () {
      return { execute: mockExecute };
    }),
  };
});

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
    getQAPlanVersion: vi.fn().mockResolvedValue({
      id: "pv2",
      version: 2,
      name: "v2",
      description: "",
      variables: { base_url: "http://example.com" },
    }),
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
            config: { method: "GET", url: "{{base_url}}/api" },
            sort_order: 0,
          },
        ],
      },
    ]),
    getQuotaStatus: vi.fn().mockResolvedValue({
      storage: { exceeded: false, used: 0, limit: -1 },
    }),
  };
}

describe("executeQAPlan", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
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
      results: [],
      resolvedVariables: {},
    });
  });

  it("uses latest version when version is not specified", async () => {
    await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
    });

    expect(client.getVersionScenarios).toHaveBeenCalledWith("p1", 1);
    expect(client.getQAPlanVersion).not.toHaveBeenCalled();
  });

  it("uses specified version", async () => {
    await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
      version: 2,
    });

    expect(client.getQAPlanVersion).toHaveBeenCalledWith("p1", 2);
    expect(client.getVersionScenarios).toHaveBeenCalledWith("p1", 2);
  });

  it("throws when plan has no versions", async () => {
    client.getQAPlan.mockResolvedValue({
      id: "p1",
      name: "Empty Plan",
      latest_version: undefined,
    });

    await expect(
      executeQAPlan(client as unknown as AquaClient, { qaPlanId: "p1" })
    ).rejects.toThrow("no versions");
  });

  it("loads environment when envName is provided", async () => {
    vi.mocked(environment.loadEnvironment).mockResolvedValue({
      variables: { api_base_url: "http://staging" },
      secretKeys: new Set(),
      secretValues: new Set(),
    });

    await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
      envName: "staging",
    });

    expect(environment.loadEnvironment).toHaveBeenCalledWith(
      "staging",
      expect.any(Set)
    );
  });

  it("does not load environment when envName is omitted", async () => {
    await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
    });

    expect(environment.loadEnvironment).not.toHaveBeenCalled();
  });

  it("passes vars as envOverrides to executor", async () => {
    const vars = { debug: "true", timeout: "60" };

    await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
      vars,
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(Object),
      "pv1",
      vars,
      undefined,
      undefined,
      undefined,
      undefined,
      false
    );
  });

  it("passes envName to executor", async () => {
    vi.mocked(environment.loadEnvironment).mockResolvedValue({
      variables: { api_key: "key" },
      secretKeys: new Set(["api_key"]),
      secretValues: new Set(["key"]),
    });

    await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
      envName: "staging",
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(Object),
      "pv1",
      undefined,
      expect.objectContaining({ variables: { api_key: "key" } }),
      "staging",
      undefined,
      undefined,
      false
    );
  });

  it("passes onExecutionCreated callback to executor", async () => {
    const onCreated = vi.fn();

    await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
      onExecutionCreated: onCreated,
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(Object),
      "pv1",
      undefined,
      undefined,
      undefined,
      onCreated,
      undefined,
      false
    );
  });

  it("returns execution summary from executor", async () => {
    const expectedSummary = {
      executionId: "exec1",
      executionUrl: "http://localhost:5173/executions/exec1",
      status: "completed" as const,
      totalSteps: 2,
      passed: 2,
      failed: 0,
      errors: 0,
      skipped: 0,
      results: [],
      resolvedVariables: { base_url: "http://example.com" },
    };
    mockExecute.mockResolvedValue(expectedSummary);

    const result = await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
    });

    expect(result).toEqual(expectedSummary);
  });

  it("converts scenario responses to QAPlanData format", async () => {
    client.getVersionScenarios.mockResolvedValue([
      {
        id: "sc1",
        name: "Login",
        requires: ["api_key"],
        sort_order: 0,
        steps: [
          {
            id: "sd1",
            step_key: "login",
            action: "http_request",
            config: { method: "POST", url: "{{base_url}}/login" },
            assertions: [{ type: "status_code", expected: 200 }],
            extract: { token: "json:$.token" },
            depends_on: [],
            sort_order: 0,
          },
        ],
      },
    ]);

    await executeQAPlan(client as unknown as AquaClient, {
      qaPlanId: "p1",
    });

    const planData = mockExecute.mock.calls[0][0];
    expect(planData.scenarios[0].name).toBe("Login");
    expect(planData.scenarios[0].requires).toEqual(["api_key"]);
    expect(planData.scenarios[0].steps[0].step_key).toBe("login");
    expect(planData.scenarios[0].steps[0].extract).toEqual({
      token: "json:$.token",
    });
  });

  it("propagates executor errors", async () => {
    mockExecute.mockRejectedValue(new Error("Playwright not installed"));

    await expect(
      executeQAPlan(client as unknown as AquaClient, { qaPlanId: "p1" })
    ).rejects.toThrow("Playwright not installed");
  });

  describe("quota pre-check", () => {
    it("passes skipRecording=false when quota is not exceeded", async () => {
      client.getQuotaStatus.mockResolvedValue({
        storage: { exceeded: false, used: 100, limit: 1000 },
      });

      await executeQAPlan(client as unknown as AquaClient, { qaPlanId: "p1" });

      const skipRecordingArg = mockExecute.mock.calls[0][7];
      expect(skipRecordingArg).toBe(false);
    });

    it("passes skipRecording=true when storage quota exceeded", async () => {
      client.getQuotaStatus.mockResolvedValue({
        storage: { exceeded: true, used: 2000, limit: 1000 },
      });

      await executeQAPlan(client as unknown as AquaClient, { qaPlanId: "p1" });

      const skipRecordingArg = mockExecute.mock.calls[0][7];
      expect(skipRecordingArg).toBe(true);
    });

    it("falls back to skipRecording=false when quota check fails", async () => {
      client.getQuotaStatus.mockRejectedValue(new Error("Network error"));

      await executeQAPlan(client as unknown as AquaClient, { qaPlanId: "p1" });

      const skipRecordingArg = mockExecute.mock.calls[0][7];
      expect(skipRecordingArg).toBe(false);
    });
  });
});
