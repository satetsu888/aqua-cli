import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerQAPlanTools } from "./qa-plan.js";
import type { AquaClient } from "../../api/client.js";

vi.mock("../../setup/git.js", () => ({
  detectCurrentBranch: () => "main",
  detectPullRequestURL: () => null,
}));

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
    createQAPlan: vi.fn(),
    getQAPlan: vi.fn(),
    listQAPlans: vi.fn(),
    createQAPlanVersion: vi.fn(),
    patchQAPlanVersion: vi.fn(),
    setQAPlanStatus: vi.fn(),
  };
}

describe("plan tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
  });

  describe("create_qa_plan", () => {
    it("creates a plan with name and description", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.createQAPlan.mockResolvedValue({ id: "p1", name: "Test" });

      const result = await server.getHandler("create_qa_plan")({
        name: "Test Plan",
        description: "A test",
      });

      expect(client.createQAPlan).toHaveBeenCalledWith({
        name: "Test Plan",
        description: "A test",
        git_branch: "main",
        pull_request_url: "",
      });
      expect(result.isError).toBeUndefined();
    });
  });

  describe("get_qa_plan", () => {
    it("returns plan data as JSON", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        name: "Test",
        status: "active",
      });

      const result = await server.getHandler("get_qa_plan")({ id: "p1" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("p1");
    });
  });

  describe("list_qa_plans", () => {
    it("lists plans without project_id parameter", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.listQAPlans.mockResolvedValue({ items: [], next_cursor: null });

      await server.getHandler("list_qa_plans")({});

      expect(client.listQAPlans).toHaveBeenCalledWith({
        status: undefined,
        limit: undefined,
        cursor: undefined,
      });
    });
  });

  describe("update_qa_plan", () => {
    it("creates new version with structured data", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.createQAPlanVersion.mockResolvedValue({
        id: "v2",
        version: 2,
      });

      const result = await server.getHandler("update_qa_plan")({
        id: "p1",
        name: "v2",
        scenarios: [
          {
            name: "S1",
            steps: [
              {
                step_key: "s1",
                action: "http_request",
                config: { method: "GET", url: "http://example.com" },
              },
            ],
          },
        ],
      });

      expect(client.createQAPlanVersion).toHaveBeenCalledWith("p1", {
        name: "v2",
        description: undefined,
        variables: undefined,
        scenarios: [
          {
            name: "S1",
            steps: [
              {
                step_key: "s1",
                action: "http_request",
                config: { method: "GET", url: "http://example.com" },
                assertions: undefined,
                extract: undefined,
                depends_on: undefined,
              },
            ],
          },
        ],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.version).toBe(2);
    });

    it("creates new version without name (name is optional)", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.createQAPlanVersion.mockResolvedValue({
        id: "v1",
        version: 1,
        name: "",
      });

      const result = await server.getHandler("update_qa_plan")({
        id: "p1",
        scenarios: [
          {
            name: "S1",
            steps: [
              {
                step_key: "s1",
                action: "http_request",
                config: { method: "GET", url: "http://example.com" },
              },
            ],
          },
        ],
      });

      expect(client.createQAPlanVersion).toHaveBeenCalledWith("p1", {
        name: undefined,
        description: undefined,
        variables: undefined,
        scenarios: [
          {
            name: "S1",
            steps: [
              {
                step_key: "s1",
                action: "http_request",
                config: { method: "GET", url: "http://example.com" },
                assertions: undefined,
                extract: undefined,
                depends_on: undefined,
              },
            ],
          },
        ],
      });
      expect(result.isError).toBeUndefined();
    });
  });

  describe("set_qa_plan_status", () => {
    it("changes plan status", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.setQAPlanStatus.mockResolvedValue({
        id: "p1",
        status: "archived",
      });

      const result = await server.getHandler("set_qa_plan_status")({
        id: "p1",
        status: "archived",
      });

      expect(client.setQAPlanStatus).toHaveBeenCalledWith("p1", "archived");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe("archived");
    });
  });

  describe("update_qa_plan_step", () => {
    it("updates a step using latest version as base", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        latest_version: { version: 3 },
      });
      client.patchQAPlanVersion.mockResolvedValue({
        id: "v4",
        version: 4,
      });

      const result = await server.getHandler("update_qa_plan_step")({
        qa_plan_id: "p1",
        step_key: "s1",
        config: { method: "POST", url: "http://example.com" },
      });

      expect(client.patchQAPlanVersion).toHaveBeenCalledWith("p1", {
        base_version: 3,
        patches: [
          {
            op: "replace_step",
            step_key: "s1",
            config: { method: "POST", url: "http://example.com" },
          },
        ],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.version).toBe(4);
    });

    it("uses explicit version as base", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.patchQAPlanVersion.mockResolvedValue({
        id: "v3",
        version: 3,
      });

      await server.getHandler("update_qa_plan_step")({
        qa_plan_id: "p1",
        step_key: "s1",
        version: 2,
        action: "browser",
      });

      expect(client.getQAPlan).not.toHaveBeenCalled();
      expect(client.patchQAPlanVersion).toHaveBeenCalledWith("p1", {
        base_version: 2,
        patches: [
          {
            op: "replace_step",
            step_key: "s1",
            action: "browser",
          },
        ],
      });
    });

    it("returns error when plan has no versions", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        latest_version: undefined,
      });

      const result = await server.getHandler("update_qa_plan_step")({
        qa_plan_id: "p1",
        step_key: "s1",
        config: { method: "GET" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no versions");
    });

    it("returns error on API failure", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        latest_version: { version: 1 },
      });
      client.patchQAPlanVersion.mockRejectedValue(
        new Error("API error 400: step_key \"s1\" not found")
      );

      const result = await server.getHandler("update_qa_plan_step")({
        qa_plan_id: "p1",
        step_key: "s1",
        config: { method: "GET" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("step_key");
    });
  });

  describe("add_qa_plan_step", () => {
    it("adds a step to a scenario using latest version", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        latest_version: { version: 1 },
      });
      client.patchQAPlanVersion.mockResolvedValue({
        id: "v2",
        version: 2,
      });

      const result = await server.getHandler("add_qa_plan_step")({
        qa_plan_id: "p1",
        scenario_name: "Login",
        step_key: "new_step",
        action: "http_request",
        config: { method: "GET", url: "http://example.com" },
      });

      expect(client.patchQAPlanVersion).toHaveBeenCalledWith("p1", {
        base_version: 1,
        patches: [
          {
            op: "add_step",
            scenario_name: "Login",
            after_step_key: undefined,
            step: {
              step_key: "new_step",
              action: "http_request",
              config: { method: "GET", url: "http://example.com" },
              assertions: undefined,
              extract: undefined,
              depends_on: undefined,
            },
          },
        ],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.version).toBe(2);
    });

    it("inserts step after specified step_key", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.patchQAPlanVersion.mockResolvedValue({
        id: "v3",
        version: 3,
      });

      await server.getHandler("add_qa_plan_step")({
        qa_plan_id: "p1",
        scenario_name: "Login",
        step_key: "new_step",
        action: "http_request",
        config: { method: "GET" },
        version: 2,
        after_step_key: "existing_step",
      });

      expect(client.patchQAPlanVersion).toHaveBeenCalledWith("p1", {
        base_version: 2,
        patches: [
          expect.objectContaining({
            op: "add_step",
            after_step_key: "existing_step",
          }),
        ],
      });
    });

    it("returns error when plan has no versions", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        latest_version: undefined,
      });

      const result = await server.getHandler("add_qa_plan_step")({
        qa_plan_id: "p1",
        scenario_name: "Login",
        step_key: "s1",
        action: "http_request",
        config: { method: "GET" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no versions");
    });
  });

  describe("remove_qa_plan_step", () => {
    it("removes a step using latest version", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        latest_version: { version: 1 },
      });
      client.patchQAPlanVersion.mockResolvedValue({
        id: "v2",
        version: 2,
      });

      const result = await server.getHandler("remove_qa_plan_step")({
        qa_plan_id: "p1",
        step_key: "old_step",
      });

      expect(client.patchQAPlanVersion).toHaveBeenCalledWith("p1", {
        base_version: 1,
        patches: [{ op: "remove_step", step_key: "old_step" }],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.version).toBe(2);
    });

    it("uses explicit version", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.patchQAPlanVersion.mockResolvedValue({
        id: "v3",
        version: 3,
      });

      await server.getHandler("remove_qa_plan_step")({
        qa_plan_id: "p1",
        step_key: "old_step",
        version: 2,
      });

      expect(client.getQAPlan).not.toHaveBeenCalled();
      expect(client.patchQAPlanVersion).toHaveBeenCalledWith("p1", {
        base_version: 2,
        patches: [{ op: "remove_step", step_key: "old_step" }],
      });
    });

    it("returns error when plan has no versions", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        latest_version: undefined,
      });

      const result = await server.getHandler("remove_qa_plan_step")({
        qa_plan_id: "p1",
        step_key: "s1",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no versions");
    });

    it("returns error when step is referenced by depends_on", async () => {
      registerQAPlanTools(server as never, client as unknown as AquaClient);
      client.getQAPlan.mockResolvedValue({
        id: "p1",
        latest_version: { version: 1 },
      });
      client.patchQAPlanVersion.mockRejectedValue(
        new Error("API error 400: step s2 depends on unknown step_key: s1")
      );

      const result = await server.getHandler("remove_qa_plan_step")({
        qa_plan_id: "p1",
        step_key: "s1",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("depends on");
    });
  });
});
