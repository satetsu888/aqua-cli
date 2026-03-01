import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerCommonScenarioTools } from "./common-scenario.js";
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
    createCommonScenario: vi.fn(),
    getCommonScenario: vi.fn(),
    listCommonScenarios: vi.fn(),
    updateCommonScenario: vi.fn(),
    deleteCommonScenario: vi.fn(),
  };
}

describe("common-scenario tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    registerCommonScenarioTools(
      server as never,
      client as unknown as AquaClient
    );
  });

  it("registers all five tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(5);
    expect(server.getHandler("create_common_scenario")).toBeDefined();
    expect(server.getHandler("get_common_scenario")).toBeDefined();
    expect(server.getHandler("list_common_scenarios")).toBeDefined();
    expect(server.getHandler("update_common_scenario")).toBeDefined();
    expect(server.getHandler("delete_common_scenario")).toBeDefined();
  });

  describe("create_common_scenario", () => {
    it("creates a common scenario and returns result", async () => {
      const created = { id: "cs-1", name: "Login" };
      client.createCommonScenario.mockResolvedValue(created);

      const result = await server.getHandler("create_common_scenario")({
        name: "Login",
        description: "Login flow",
        steps: [
          {
            step_key: "open-login",
            action: "browser",
            config: { steps: [{ action: "goto", url: "http://example.com" }] },
          },
        ],
      });

      expect(client.createCommonScenario).toHaveBeenCalledWith({
        name: "Login",
        description: "Login flow",
        requires: undefined,
        steps: [
          {
            step_key: "open-login",
            action: "browser",
            config: { steps: [{ action: "goto", url: "http://example.com" }] },
            assertions: undefined,
            extract: undefined,
            depends_on: undefined,
          },
        ],
      });
      expect(JSON.parse(result.content[0].text)).toEqual(created);
    });

    it("unescapes unicode in name and description", async () => {
      client.createCommonScenario.mockResolvedValue({ id: "cs-2" });

      await server.getHandler("create_common_scenario")({
        name: "\\u30ED\\u30B0\\u30A4\\u30F3",
        description: "\\u8A8D\\u8A3C",
        steps: [],
      });

      expect(client.createCommonScenario).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ログイン",
          description: "認証",
        })
      );
    });
  });

  describe("get_common_scenario", () => {
    it("returns the scenario by id", async () => {
      const scenario = { id: "cs-1", name: "Login", steps: [] };
      client.getCommonScenario.mockResolvedValue(scenario);

      const result = await server.getHandler("get_common_scenario")({
        id: "cs-1",
      });

      expect(client.getCommonScenario).toHaveBeenCalledWith("cs-1");
      expect(JSON.parse(result.content[0].text)).toEqual(scenario);
    });
  });

  describe("list_common_scenarios", () => {
    it("returns all scenarios", async () => {
      const scenarios = [
        { id: "cs-1", name: "Login" },
        { id: "cs-2", name: "Logout" },
      ];
      client.listCommonScenarios.mockResolvedValue(scenarios);

      const result = await server.getHandler("list_common_scenarios")({});

      expect(client.listCommonScenarios).toHaveBeenCalled();
      expect(JSON.parse(result.content[0].text)).toEqual(scenarios);
    });
  });

  describe("update_common_scenario", () => {
    it("updates specified fields only", async () => {
      const updated = { id: "cs-1", name: "Login v2" };
      client.updateCommonScenario.mockResolvedValue(updated);

      const result = await server.getHandler("update_common_scenario")({
        id: "cs-1",
        name: "Login v2",
      });

      expect(client.updateCommonScenario).toHaveBeenCalledWith("cs-1", {
        name: "Login v2",
        description: undefined,
        requires: undefined,
        steps: undefined,
      });
      expect(JSON.parse(result.content[0].text)).toEqual(updated);
    });
  });

  describe("delete_common_scenario", () => {
    it("deletes and returns success message", async () => {
      client.deleteCommonScenario.mockResolvedValue(undefined);

      const result = await server.getHandler("delete_common_scenario")({
        id: "cs-1",
      });

      expect(client.deleteCommonScenario).toHaveBeenCalledWith("cs-1");
      expect(result.content[0].text).toContain("deleted successfully");
    });
  });
});
