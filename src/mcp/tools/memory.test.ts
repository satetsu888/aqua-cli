import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerMemoryTools } from "./memory.js";
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
    getProjectMemory: vi.fn(),
    updateProjectMemory: vi.fn(),
  };
}

describe("memory tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = createMockServer();
    client = createMockClient();
  });

  describe("get_project_memory", () => {
    it("returns template when memory is empty", async () => {
      client.getProjectMemory.mockResolvedValue({ content: "" });
      registerMemoryTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("get_project_memory")({});

      expect(client.getProjectMemory).toHaveBeenCalledWith();
      const text = result.content[0].text;
      expect(text).toContain("# Project Memory");
      expect(text).toContain("TEMPLATE");
      expect(text).toContain("(Replace this with");
    });

    it("returns actual content when memory is set", async () => {
      const memoryContent = "# My Project\n\nReal memory content";
      client.getProjectMemory.mockResolvedValue({ content: memoryContent });
      registerMemoryTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("get_project_memory")({});

      expect(result.content[0].text).toBe(memoryContent);
    });
  });

  describe("save_project_memory", () => {
    it("saves memory content", async () => {
      const content = "# Updated Memory\n\nNew content";
      client.updateProjectMemory.mockResolvedValue({ content });
      registerMemoryTools(server as never, client as unknown as AquaClient);

      const result = await server.getHandler("save_project_memory")({
        content,
      });

      expect(client.updateProjectMemory).toHaveBeenCalledWith(content);
      expect(result.content[0].text).toContain("saved successfully");
    });
  });

  it("registers both tools", () => {
    client.getProjectMemory.mockResolvedValue({ content: "" });
    registerMemoryTools(server as never, client as unknown as AquaClient);

    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("get_project_memory")).toBeDefined();
    expect(server.getHandler("save_project_memory")).toBeDefined();
  });
});
