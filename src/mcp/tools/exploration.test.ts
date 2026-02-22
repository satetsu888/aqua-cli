import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerExplorationTools } from "./exploration.js";
import type { AquaClient } from "../../api/client.js";
import * as environment from "../../environment/index.js";

vi.mock("../../environment/index.js", () => ({
  loadEnvironment: vi.fn(),
}));

const mockExecuteSingleBrowserStep = vi.fn();
const mockGetPageState = vi.fn();
const mockEvaluateSingleAssertion = vi.fn();
const mockBrowserClose = vi.fn();

vi.mock("../../driver/browser.js", () => {
  return {
    BrowserDriver: vi.fn(function () {
      return {
        executeSingleBrowserStep: mockExecuteSingleBrowserStep,
        getPageState: mockGetPageState,
        evaluateSingleAssertion: mockEvaluateSingleAssertion,
        close: mockBrowserClose,
      };
    }),
  };
});

const mockHttpExecute = vi.fn();

vi.mock("../../driver/http.js", () => {
  return {
    HttpDriver: vi.fn(function () {
      return { execute: mockHttpExecute };
    }),
  };
});

vi.mock("../../driver/step-utils.js", () => ({
  checkBrowserDependencies: vi.fn().mockResolvedValue(undefined),
}));

type ToolCallback = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>
) => Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
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

describe("exploration tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    vi.mocked(environment.loadEnvironment).mockReset();
    mockExecuteSingleBrowserStep.mockReset();
    mockGetPageState.mockReset();
    mockEvaluateSingleAssertion.mockReset();
    mockBrowserClose.mockReset().mockResolvedValue(undefined);
    mockHttpExecute.mockReset();
  });

  it("registers all three exploration tools", () => {
    registerExplorationTools(server as never, client as unknown as AquaClient);
    expect(server.tool).toHaveBeenCalledWith(
      "start_exploration",
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(server.tool).toHaveBeenCalledWith(
      "explore_action",
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(server.tool).toHaveBeenCalledWith(
      "end_exploration",
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
  });

  describe("start_exploration", () => {
    it("creates a session and returns session ID", async () => {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      const result = await server.getHandler("start_exploration")({});

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain("Exploration session started.");
      expect(text).toContain("Session ID:");
      expect(text).toContain("**Variables loaded:** 0");
    });

    it("loads plan variables when qa_plan_id is provided", async () => {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      const result = await server.getHandler("start_exploration")({
        qa_plan_id: "p1",
      });

      expect(client.getQAPlan).toHaveBeenCalledWith("p1");
      expect(result.content[0].text).toContain("**Variables loaded:** 1");
    });

    it("uses specific plan version when version is provided", async () => {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      await server.getHandler("start_exploration")({
        qa_plan_id: "p1",
        version: 2,
      });

      expect(client.getQAPlanVersion).toHaveBeenCalledWith("p1", 2);
    });

    it("loads environment when env_name is provided", async () => {
      vi.mocked(environment.loadEnvironment).mockResolvedValue({
        variables: { api_base_url: "http://staging", api_key: "secret" },
        secretKeys: new Set(["api_key"]),
        secretValues: new Set(["secret"]),
      });
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      const result = await server.getHandler("start_exploration")({
        env_name: "staging",
      });

      expect(environment.loadEnvironment).toHaveBeenCalledWith("staging");
      expect(result.content[0].text).toContain("**Variables loaded:** 2");
    });

    it("merges variables with correct priority (plan < env < override)", async () => {
      vi.mocked(environment.loadEnvironment).mockResolvedValue({
        variables: { api_base_url: "http://env-value", env_only: "from-env" },
        secretKeys: new Set(),
        secretValues: new Set(),
      });
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      // Start session with all variable sources
      const startResult = await server.getHandler("start_exploration")({
        qa_plan_id: "p1",
        env_name: "staging",
        environment: { api_base_url: "http://override" },
      });

      // Variables loaded: api_base_url (overridden), env_only
      expect(startResult.content[0].text).toContain("Variables loaded:");

      // Verify by running an HTTP action that uses the variables
      const sessionId = startResult.content[0].text!.match(
        /Session ID:\*\* (.+)/
      )![1];

      mockHttpExecute.mockResolvedValue({
        stepKey: "explore_http",
        action: "http_request",
        status: "passed",
        response: {
          status: 200,
          body: "{}",
          duration: 10,
          headers: {},
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      });

      await server.getHandler("explore_action")({
        session_id: sessionId,
        http_request: { method: "GET", url: "{{api_base_url}}/test" },
      });

      // HttpDriver.execute receives variables with override taking priority
      const passedVariables = mockHttpExecute.mock.calls[0][1];
      expect(passedVariables.api_base_url).toBe("http://override");
      expect(passedVariables.env_only).toBe("from-env");
    });

    it("returns error when environment loading fails", async () => {
      vi.mocked(environment.loadEnvironment).mockRejectedValue(
        new Error("Environment file not found")
      );
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      const result = await server.getHandler("start_exploration")({
        env_name: "nonexistent",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Environment file not found");
    });

    it("returns error when plan loading fails", async () => {
      client.getQAPlan.mockRejectedValue(new Error("Plan not found"));
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      const result = await server.getHandler("start_exploration")({
        qa_plan_id: "nonexistent",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Plan not found");
    });
  });

  describe("explore_action", () => {
    async function startSession(
      overrides?: Record<string, unknown>
    ): Promise<string> {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );
      const result = await server.getHandler("start_exploration")(
        overrides ?? {}
      );
      return result.content[0].text!.match(/Session ID:\*\* (.+)/)![1];
    }

    it("returns error for expired/unknown session", async () => {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      const result = await server.getHandler("explore_action")({
        session_id: "nonexistent",
        browser_step: { goto: "http://example.com" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Session not found");
    });

    it("returns error when no action is provided", async () => {
      const sessionId = await startSession();

      const result = await server.getHandler("explore_action")({
        session_id: sessionId,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Provide exactly one of");
    });

    describe("browser_step", () => {
      it("executes a browser step and returns page state", async () => {
        const sessionId = await startSession();

        mockExecuteSingleBrowserStep.mockResolvedValue(undefined);
        mockGetPageState.mockResolvedValue({
          screenshot: Buffer.from("fake-png"),
          dom: "<html><body><h1>Hello</h1></body></html>",
          url: "http://example.com",
          title: "Example",
        });

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_step: { goto: "http://example.com" },
        });

        expect(result.isError).toBeUndefined();
        const text = result.content[0].text!;
        expect(text).toContain("**URL:** http://example.com");
        expect(text).toContain("**Title:** Example");
        expect(text).toContain("<h1>Hello</h1>");
        // Screenshot returned as inline image content
        const imageContent = result.content.find((c) => c.type === "image");
        expect(imageContent).toBeDefined();
        expect(imageContent!.mimeType).toBe("image/png");
        expect(imageContent!.data).toBe(Buffer.from("fake-png").toString("base64"));
      });

      it("returns page state even when step fails", async () => {
        const sessionId = await startSession();

        mockExecuteSingleBrowserStep.mockRejectedValue(
          new Error("Element not found: #missing")
        );
        mockGetPageState.mockResolvedValue({
          screenshot: Buffer.from("fake-png"),
          dom: "<html><body>page</body></html>",
          url: "http://example.com",
          title: "Example",
        });

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_step: { click: "#missing" },
        });

        const text = result.content[0].text;
        expect(text).toContain("**Error:** Element not found: #missing");
        expect(text).toContain("**URL:** http://example.com");
        expect(text).toContain("## DOM");
      });

      it("handles case when page state cannot be captured", async () => {
        const sessionId = await startSession();

        mockExecuteSingleBrowserStep.mockRejectedValue(
          new Error("Browser crashed")
        );
        mockGetPageState.mockResolvedValue(null);

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_step: { goto: "http://example.com" },
        });

        const text = result.content[0].text;
        expect(text).toContain("Action failed: Browser crashed");
        expect(text).toContain("Browser state could not be captured");
      });

      it("passes timeout_ms to browser driver", async () => {
        const sessionId = await startSession();

        mockExecuteSingleBrowserStep.mockResolvedValue(undefined);
        mockGetPageState.mockResolvedValue({
          screenshot: Buffer.from("fake-png"),
          dom: "<html></html>",
          url: "http://example.com",
          title: "",
        });

        await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_step: { click: "#btn" },
          timeout_ms: 5000,
        });

        expect(mockExecuteSingleBrowserStep).toHaveBeenCalledWith(
          { click: "#btn" },
          5000
        );
      });
    });

    describe("http_request", () => {
      it("executes HTTP request and returns response", async () => {
        const sessionId = await startSession();

        mockHttpExecute.mockResolvedValue({
          stepKey: "explore_http",
          action: "http_request",
          status: "passed",
          response: {
            status: 200,
            body: '{"users":[{"id":1,"name":"Alice"}]}',
            duration: 50,
            headers: { "content-type": "application/json" },
          },
          startedAt: new Date(),
          finishedAt: new Date(),
        });

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          http_request: { method: "GET", url: "http://api.example.com/users" },
        });

        const text = result.content[0].text;
        expect(text).toContain("**Status:** 200");
        expect(text).toContain("**Duration:** 50ms");
        expect(text).toContain("content-type: application/json");
        expect(text).toContain('"users"');
      });

      it("extracts values and merges into session variables", async () => {
        const sessionId = await startSession();

        mockHttpExecute.mockResolvedValue({
          stepKey: "explore_http",
          action: "http_request",
          status: "passed",
          response: {
            status: 200,
            body: '{"token":"abc123"}',
            duration: 10,
            headers: {},
          },
          extractedValues: { auth_token: "abc123" },
          startedAt: new Date(),
          finishedAt: new Date(),
        });

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          http_request: {
            method: "POST",
            url: "http://api.example.com/login",
          },
          extract: { auth_token: "$.token" },
        });

        const text = result.content[0].text;
        expect(text).toContain("## Extracted Values");
        expect(text).toContain("auth_token");

        // Verify extracted values are available for subsequent actions
        mockHttpExecute.mockResolvedValue({
          stepKey: "explore_http",
          action: "http_request",
          status: "passed",
          response: {
            status: 200,
            body: "{}",
            duration: 10,
            headers: {},
          },
          startedAt: new Date(),
          finishedAt: new Date(),
        });

        await server.getHandler("explore_action")({
          session_id: sessionId,
          http_request: {
            method: "GET",
            url: "http://api.example.com/me",
            headers: { Authorization: "Bearer {{auth_token}}" },
          },
        });

        const passedVariables = mockHttpExecute.mock.calls[1][1];
        expect(passedVariables.auth_token).toBe("abc123");
      });

      it("shows error for failed HTTP request", async () => {
        const sessionId = await startSession();

        mockHttpExecute.mockResolvedValue({
          stepKey: "explore_http",
          action: "http_request",
          status: "error",
          errorMessage: "Connection refused",
          startedAt: new Date(),
          finishedAt: new Date(),
        });

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          http_request: { method: "GET", url: "http://localhost:9999" },
        });

        expect(result.content[0].text).toContain(
          "**Error:** Connection refused"
        );
      });
    });

    describe("browser_assertion", () => {
      it("evaluates assertion and returns result", async () => {
        const sessionId = await startSession();

        // First, initialize browser via a browser_step
        mockExecuteSingleBrowserStep.mockResolvedValue(undefined);
        mockGetPageState.mockResolvedValue({
          screenshot: Buffer.from("fake-png"),
          dom: "<html></html>",
          url: "http://example.com",
          title: "",
        });
        await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_step: { goto: "http://example.com" },
        });

        mockEvaluateSingleAssertion.mockResolvedValue({
          type: "element_visible",
          expected: '"#login-form" is visible',
          actual: "visible",
          passed: true,
        });

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_assertion: {
            type: "element_visible",
            selector: "#login-form",
          },
        });

        const text = result.content[0].text;
        expect(text).toContain("**[PASS]** element_visible");
        expect(text).toContain("**Actual:** visible");
      });

      it("returns error when browser is not initialized", async () => {
        const sessionId = await startSession();

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_assertion: {
            type: "element_visible",
            selector: "#login-form",
          },
        });

        expect(result.content[0].text).toContain(
          "Browser is not initialized"
        );
      });

      it("shows failed assertion details", async () => {
        const sessionId = await startSession();

        // Initialize browser
        mockExecuteSingleBrowserStep.mockResolvedValue(undefined);
        mockGetPageState.mockResolvedValue({
          screenshot: Buffer.from("fake-png"),
          dom: "<html></html>",
          url: "http://example.com",
          title: "",
        });
        await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_step: { goto: "http://example.com" },
        });

        mockEvaluateSingleAssertion.mockResolvedValue({
          type: "element_text",
          expected: 'contains "Welcome"',
          actual: "Login Page",
          passed: false,
          message: 'Text "Login Page" does not contain "Welcome"',
        });

        const result = await server.getHandler("explore_action")({
          session_id: sessionId,
          browser_assertion: {
            type: "element_text",
            selector: "h1",
            contains: "Welcome",
          },
        });

        const text = result.content[0].text;
        expect(text).toContain("**[FAIL]** element_text");
        expect(text).toContain("**Message:**");
      });
    });
  });

  describe("end_exploration", () => {
    it("ends session and returns confirmation", async () => {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );
      const startResult = await server.getHandler("start_exploration")({});
      const sessionId = startResult.content[0].text!.match(
        /Session ID:\*\* (.+)/
      )![1];

      const result = await server.getHandler("end_exploration")({
        session_id: sessionId,
      });

      expect(result.content[0].text).toContain("Exploration session ended.");
    });

    it("closes browser driver when session has one", async () => {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );
      const startResult = await server.getHandler("start_exploration")({});
      const sessionId = startResult.content[0].text!.match(
        /Session ID:\*\* (.+)/
      )![1];

      // Initialize browser by running a browser step
      mockExecuteSingleBrowserStep.mockResolvedValue(undefined);
      mockGetPageState.mockResolvedValue({
        screenshot: Buffer.from("fake-png"),
        dom: "<html></html>",
        url: "http://example.com",
        title: "",
      });
      await server.getHandler("explore_action")({
        session_id: sessionId,
        browser_step: { goto: "http://example.com" },
      });

      await server.getHandler("end_exploration")({
        session_id: sessionId,
      });

      expect(mockBrowserClose).toHaveBeenCalled();
    });

    it("handles already-ended session gracefully", async () => {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );

      const result = await server.getHandler("end_exploration")({
        session_id: "nonexistent",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain(
        "Session not found (already expired or ended)"
      );
    });

    it("session is no longer accessible after ending", async () => {
      registerExplorationTools(
        server as never,
        client as unknown as AquaClient
      );
      const startResult = await server.getHandler("start_exploration")({});
      const sessionId = startResult.content[0].text!.match(
        /Session ID:\*\* (.+)/
      )![1];

      await server.getHandler("end_exploration")({
        session_id: sessionId,
      });

      const result = await server.getHandler("explore_action")({
        session_id: sessionId,
        browser_step: { goto: "http://example.com" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Session not found");
    });
  });
});
