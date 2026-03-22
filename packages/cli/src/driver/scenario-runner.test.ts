import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScenarioRunner } from "./scenario-runner.js";
import { Masker } from "../masking/index.js";
import type { Scenario, StepResult } from "../qa-plan/types.js";

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

describe("ScenarioRunner", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  function mockHttpResponse(status: number, body: string) {
    const headers = new Map([["content-type", "application/json"]]);
    return {
      status,
      text: () => Promise.resolve(body),
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          headers.forEach((v, k) => cb(v, k)),
      },
    };
  }

  function makeScenario(overrides?: Partial<Scenario>): Scenario {
    return {
      id: "sc1",
      name: "Test Scenario",
      sort_order: 0,
      steps: [
        {
          id: "sd1",
          step_key: "step1",
          action: "http_request",
          config: { method: "GET", url: "http://example.com/api" },
          sort_order: 0,
        },
      ],
      ...overrides,
    };
  }

  function noopMasker() {
    return new Masker({ secretKeys: new Set(), secretValues: new Set() });
  }

  it("executes a single HTTP step and returns passed", async () => {
    mockFetch.mockResolvedValue(mockHttpResponse(200, '{"ok":true}'));

    const runner = new ScenarioRunner();
    const result = await runner.run(
      makeScenario(),
      {},
      noopMasker(),
    );

    expect(result.status).toBe("passed");
    expect(result.totalSteps).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("returns failed when assertion fails", async () => {
    mockFetch.mockResolvedValue(mockHttpResponse(500, "{}"));

    const scenario = makeScenario({
      steps: [
        {
          id: "sd1",
          step_key: "check_api",
          action: "http_request",
          config: { method: "GET", url: "http://example.com" },
          assertions: [{ type: "status_code", expected: 200 }],
          sort_order: 0,
        },
      ],
    });

    const runner = new ScenarioRunner();
    const result = await runner.run(scenario, {}, noopMasker());

    expect(result.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.results[0].assertionResults?.[0].passed).toBe(false);
  });

  it("returns error when network request fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const runner = new ScenarioRunner();
    const result = await runner.run(makeScenario(), {}, noopMasker());

    expect(result.status).toBe("error");
    expect(result.errors).toBe(1);
  });

  it("skips all steps when required variables are missing", async () => {
    const scenario = makeScenario({
      requires: ["db_url", "db_password"],
      steps: [
        {
          id: "sd1",
          step_key: "db_check",
          action: "http_request",
          config: { method: "GET", url: "http://example.com" },
          sort_order: 0,
        },
        {
          id: "sd2",
          step_key: "db_verify",
          action: "http_request",
          config: { method: "GET", url: "http://example.com" },
          sort_order: 1,
        },
      ],
    });

    const runner = new ScenarioRunner();
    const result = await runner.run(scenario, {}, noopMasker());

    expect(result.status).toBe("passed"); // all skipped = passed (no failures)
    expect(result.skipped).toBe(2);
    expect(result.results[0].errorMessage).toContain("db_url");
    expect(result.results[0].errorMessage).toContain("db_password");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("executes scenario when required variables are present", async () => {
    mockFetch.mockResolvedValue(mockHttpResponse(200, "{}"));

    const scenario = makeScenario({
      requires: ["api_key"],
    });

    const runner = new ScenarioRunner();
    const result = await runner.run(
      scenario,
      { api_key: "test-key" },
      noopMasker(),
    );

    expect(result.status).toBe("passed");
    expect(result.passed).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("skips step when dependency not met", async () => {
    mockFetch.mockResolvedValue(mockHttpResponse(500, "{}"));

    const scenario = makeScenario({
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
          step_key: "get_data",
          action: "http_request",
          depends_on: ["login"],
          config: { method: "GET", url: "http://example.com/data" },
          sort_order: 1,
        },
      ],
    });

    const runner = new ScenarioRunner();
    const result = await runner.run(scenario, {}, noopMasker());

    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results[1].status).toBe("skipped");
    expect(result.results[1].errorMessage).toBe("Dependency not met");
  });

  it("expands template variables in step config", async () => {
    mockFetch.mockResolvedValue(mockHttpResponse(200, "{}"));

    const scenario = makeScenario({
      steps: [
        {
          id: "sd1",
          step_key: "call_api",
          action: "http_request",
          config: { method: "GET", url: "{{api_base_url}}/users" },
          sort_order: 0,
        },
      ],
    });

    const runner = new ScenarioRunner();
    await runner.run(
      scenario,
      { api_base_url: "http://localhost:3000" },
      noopMasker(),
    );

    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:3000/users");
  });

  it("merges extracted values into variables", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(mockHttpResponse(200, '{"token":"abc123"}'));
      }
      return Promise.resolve(mockHttpResponse(200, "{}"));
    });

    const scenario = makeScenario({
      steps: [
        {
          id: "sd1",
          step_key: "login",
          action: "http_request",
          config: { method: "POST", url: "http://example.com/login" },
          extract: { auth_token: "$.token" },
          sort_order: 0,
        },
        {
          id: "sd2",
          step_key: "get_profile",
          action: "http_request",
          config: {
            method: "GET",
            url: "http://example.com/me",
            headers: { Authorization: "Bearer {{auth_token}}" },
          },
          sort_order: 1,
        },
      ],
    });

    const runner = new ScenarioRunner();
    const result = await runner.run(scenario, {}, noopMasker());

    expect(result.status).toBe("passed");
    expect(result.passed).toBe(2);
    // Verify the second request used the extracted token
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer abc123");
  });

  it("masks secret values in resolvedVariables", async () => {
    mockFetch.mockResolvedValue(mockHttpResponse(200, "{}"));

    const masker = new Masker({
      secretKeys: new Set(["api_key"]),
      secretValues: new Set(["secret-value"]),
    });

    const runner = new ScenarioRunner();
    const result = await runner.run(
      makeScenario(),
      { api_key: "secret-value", base_url: "http://example.com" },
      masker,
    );

    expect(result.resolvedVariables.api_key).toBe("***");
    expect(result.resolvedVariables.base_url).toBe("http://example.com");
  });

  it("includes response details in step results", async () => {
    mockFetch.mockResolvedValue(mockHttpResponse(201, '{"id":"123"}'));

    const runner = new ScenarioRunner();
    const result = await runner.run(makeScenario(), {}, noopMasker());

    expect(result.results[0].response).toBeDefined();
    expect(result.results[0].response!.status).toBe(201);
    expect(result.results[0].response!.body).toBe('{"id":"123"}');
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

      const scenario = makeScenario({
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
      });

      const runner = new ScenarioRunner();
      const result = await runner.run(scenario, {}, noopMasker());

      expect(result.errors).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.results[0].status).toBe("error");
      expect(result.results[0].abortScenario).toBe(true);
      expect(result.results[1].status).toBe("skipped");
      expect(result.results[1].errorMessage).toBe("Scenario aborted due to navigation failure");
      expect(result.results[2].status).toBe("skipped");
      // BrowserDriver.execute should only be called once
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("does not abort when step errors without abortScenario flag", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));

      const scenario = makeScenario({
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
      });

      const runner = new ScenarioRunner();
      const result = await runner.run(scenario, {}, noopMasker());

      // Both steps should be executed (both error, not aborted)
      expect(result.errors).toBe(2);
      expect(result.skipped).toBe(0);
    });
  });

  describe("plugin action dispatch", () => {
    it("delegates to plugin driver for unknown action types", async () => {
      const mockPluginExecute = vi.fn().mockResolvedValue({
        stepKey: "step1",
        scenarioName: "",
        action: "stripe",
        status: "passed",
        startedAt: new Date(),
        finishedAt: new Date(),
      });

      const mockRegistry = {
        getPlugin: vi.fn().mockReturnValue({ name: "stripe-plugin" }),
        getOrCreateDriver: vi.fn().mockResolvedValue({ execute: mockPluginExecute }),
        clearDriverCache: vi.fn(),
      };

      const scenario = makeScenario({
        steps: [
          {
            id: "sd1",
            step_key: "step1",
            action: "stripe",
            config: { operation: "get_subscription", params: { id: "sub_123" } },
            sort_order: 0,
          },
        ],
      });

      const runner = new ScenarioRunner(undefined, mockRegistry as never);
      const result = await runner.run(scenario, { stripe_api_key: "sk_test" }, noopMasker());

      expect(result.status).toBe("passed");
      expect(result.passed).toBe(1);
      expect(mockRegistry.getPlugin).toHaveBeenCalledWith("stripe");
      expect(mockRegistry.getOrCreateDriver).toHaveBeenCalledWith(
        "stripe",
        expect.objectContaining({ stripe_api_key: "sk_test" }),
      );
      expect(mockPluginExecute).toHaveBeenCalled();
    });

    it("returns error for unknown action when no plugin registered", async () => {
      const mockRegistry = {
        getPlugin: vi.fn().mockReturnValue(undefined),
        getOrCreateDriver: vi.fn(),
        clearDriverCache: vi.fn(),
      };

      const scenario = makeScenario({
        steps: [
          {
            id: "sd1",
            step_key: "step1",
            action: "unknown_action",
            config: {},
            sort_order: 0,
          },
        ],
      });

      const runner = new ScenarioRunner(undefined, mockRegistry as never);
      const result = await runner.run(scenario, {}, noopMasker());

      expect(result.status).toBe("error");
      expect(result.errors).toBe(1);
      expect(result.results[0].errorMessage).toContain("unknown_action");
    });

    it("returns error for unknown action when no plugin registry", async () => {
      const scenario = makeScenario({
        steps: [
          {
            id: "sd1",
            step_key: "step1",
            action: "nonexistent",
            config: {},
            sort_order: 0,
          },
        ],
      });

      const runner = new ScenarioRunner();
      const result = await runner.run(scenario, {}, noopMasker());

      expect(result.status).toBe("error");
      expect(result.results[0].errorMessage).toContain("nonexistent");
    });

    it("clears plugin driver cache after scenario completes", async () => {
      const mockRegistry = {
        getPlugin: vi.fn().mockReturnValue(undefined),
        getOrCreateDriver: vi.fn(),
        clearDriverCache: vi.fn(),
      };

      const runner = new ScenarioRunner(undefined, mockRegistry as never);
      await runner.run(makeScenario(), {}, noopMasker());

      expect(mockRegistry.clearDriverCache).toHaveBeenCalled();
    });
  });
});
