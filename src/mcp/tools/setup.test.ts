import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerSetupTools } from "./setup.js";
import type { AquaClient } from "../../api/client.js";
import type { AquaConfig } from "../../config/index.js";

vi.mock("../../environment/index.js", () => ({
  listEnvironments: vi.fn(),
}));

import { listEnvironments } from "../../environment/index.js";

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
    getProjectMemory: vi.fn(),
    listCommonScenarios: vi.fn(),
  };
}

describe("setup tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
    vi.mocked(listEnvironments).mockReset();
  });

  it("registers check_project_setup tool", () => {
    registerSetupTools(server as never, client as unknown as AquaClient, null);
    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.getHandler("check_project_setup")).toBeDefined();
  });

  describe("check_project_setup", () => {
    it("shows not initialized when config is null", async () => {
      vi.mocked(listEnvironments).mockResolvedValue([]);
      registerSetupTools(
        server as never,
        client as unknown as AquaClient,
        null
      );

      const result = await server.getHandler("check_project_setup")({});
      const text = result.content[0].text;

      expect(text).toContain("Not initialized");
      expect(text).toContain("npx @aquaqa/cli init");
    });

    it("shows initialized with config details", async () => {
      vi.mocked(listEnvironments).mockResolvedValue([]);
      client.getProjectMemory.mockResolvedValue({ content: "" });
      client.listCommonScenarios.mockResolvedValue([]);

      const config: AquaConfig = {
        server_url: "https://app.aquaqa.com",
        project_key: "github.com/owner/repo",
      };
      registerSetupTools(
        server as never,
        client as unknown as AquaClient,
        config
      );

      const result = await server.getHandler("check_project_setup")({});
      const text = result.content[0].text;

      expect(text).toContain("Initialized");
      expect(text).toContain("https://app.aquaqa.com");
      expect(text).toContain("github.com/owner/repo");
    });

    it("shows project memory status when has content", async () => {
      vi.mocked(listEnvironments).mockResolvedValue([]);
      client.getProjectMemory.mockResolvedValue({
        content: "Real project memory",
      });
      client.listCommonScenarios.mockResolvedValue([]);

      const config: AquaConfig = {
        server_url: "https://app.aquaqa.com",
        project_key: "github.com/owner/repo",
      };
      registerSetupTools(
        server as never,
        client as unknown as AquaClient,
        config
      );

      const result = await server.getHandler("check_project_setup")({});
      const text = result.content[0].text;

      expect(text).toContain("Has content");
    });

    it("shows empty memory when content is template", async () => {
      vi.mocked(listEnvironments).mockResolvedValue([]);
      client.getProjectMemory.mockResolvedValue({
        content: "This is a TEMPLATE for project memory",
      });
      client.listCommonScenarios.mockResolvedValue([]);

      const config: AquaConfig = {
        server_url: "https://app.aquaqa.com",
        project_key: "github.com/owner/repo",
      };
      registerSetupTools(
        server as never,
        client as unknown as AquaClient,
        config
      );

      const result = await server.getHandler("check_project_setup")({});
      const text = result.content[0].text;

      expect(text).toContain("Empty");
    });

    it("shows environments when available", async () => {
      vi.mocked(listEnvironments).mockResolvedValue([
        { name: "staging", notes: undefined },
        { name: "production", notes: undefined },
      ]);
      client.getProjectMemory.mockResolvedValue({ content: "" });
      client.listCommonScenarios.mockResolvedValue([]);

      const config: AquaConfig = {
        server_url: "https://app.aquaqa.com",
        project_key: "github.com/owner/repo",
      };
      registerSetupTools(
        server as never,
        client as unknown as AquaClient,
        config
      );

      const result = await server.getHandler("check_project_setup")({});
      const text = result.content[0].text;

      expect(text).toContain("2 environment(s) available");
      expect(text).toContain("staging");
      expect(text).toContain("production");
    });

    it("shows common scenarios when available", async () => {
      vi.mocked(listEnvironments).mockResolvedValue([]);
      client.getProjectMemory.mockResolvedValue({ content: "" });
      client.listCommonScenarios.mockResolvedValue([
        { id: "cs-1", name: "Login" },
      ]);

      const config: AquaConfig = {
        server_url: "https://app.aquaqa.com",
        project_key: "github.com/owner/repo",
      };
      registerSetupTools(
        server as never,
        client as unknown as AquaClient,
        config
      );

      const result = await server.getHandler("check_project_setup")({});
      const text = result.content[0].text;

      expect(text).toContain("1 scenario(s) available");
      expect(text).toContain("Login");
    });

    it("skips server checks when project_key is not set", async () => {
      vi.mocked(listEnvironments).mockResolvedValue([]);

      const config: AquaConfig = {
        server_url: "https://app.aquaqa.com",
      };
      registerSetupTools(
        server as never,
        client as unknown as AquaClient,
        config
      );

      const result = await server.getHandler("check_project_setup")({});
      const text = result.content[0].text;

      expect(text).toContain("Requires project setup");
      expect(client.getProjectMemory).not.toHaveBeenCalled();
      expect(client.listCommonScenarios).not.toHaveBeenCalled();
    });
  });
});
