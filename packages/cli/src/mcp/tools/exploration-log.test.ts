import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerExplorationLogTools } from "./exploration-log.js";

vi.mock("../../exploration/log.js", () => ({
  listExplorationLogs: vi.fn(),
  getExplorationLog: vi.fn(),
}));

import {
  listExplorationLogs,
  getExplorationLog,
} from "../../exploration/log.js";

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

describe("exploration-log tools", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(listExplorationLogs).mockReset();
    vi.mocked(getExplorationLog).mockReset();
    registerExplorationLogTools(server as never, "github.com/owner/repo");
  });

  it("registers both tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.getHandler("list_exploration_logs")).toBeDefined();
    expect(server.getHandler("get_exploration_log")).toBeDefined();
  });

  describe("list_exploration_logs", () => {
    it("returns message when no logs found", async () => {
      vi.mocked(listExplorationLogs).mockReturnValue([]);

      const result = await server.getHandler("list_exploration_logs")({});
      const text = result.content[0].text;

      expect(text).toContain("No exploration logs found");
    });

    it("lists recent exploration sessions", async () => {
      vi.mocked(listExplorationLogs).mockReturnValue([
        {
          session_id: "sess-1",
          project_key: "github.com/owner/repo",
          started_at: "2026-01-15T10:30:00Z",
          updated_at: "2026-01-15T10:35:00Z",
          actions: [
            {
              type: "browser_step",
              input: { action: "goto", url: "http://example.com" },
              success: true,
              url_after: "http://example.com/",
              timestamp: "2026-01-15T10:30:01Z",
            },
            {
              type: "browser_step",
              input: { action: "click", selector: "#btn" },
              success: false,
              error: "Element not found",
              timestamp: "2026-01-15T10:30:05Z",
            },
          ],
        },
      ]);

      const result = await server.getHandler("list_exploration_logs")({});
      const text = result.content[0].text;

      expect(text).toContain("sess-1");
      expect(text).toContain("2 actions, 1 successful");
      expect(text).toContain("http://example.com/");
      expect(listExplorationLogs).toHaveBeenCalledWith(
        "github.com/owner/repo",
        undefined
      );
    });

    it("passes limit parameter", async () => {
      vi.mocked(listExplorationLogs).mockReturnValue([]);

      await server.getHandler("list_exploration_logs")({ limit: 5 });

      expect(listExplorationLogs).toHaveBeenCalledWith(
        "github.com/owner/repo",
        5
      );
    });
  });

  describe("get_exploration_log", () => {
    it("returns error when log not found", async () => {
      vi.mocked(getExplorationLog).mockReturnValue(null);

      const result = await server.getHandler("get_exploration_log")({
        session_id: "nonexistent",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("returns full log with action details", async () => {
      vi.mocked(getExplorationLog).mockReturnValue({
        session_id: "sess-1",
        project_key: "github.com/owner/repo",
        started_at: "2026-01-15T10:30:00Z",
        updated_at: "2026-01-15T10:35:00Z",
        actions: [
          {
            type: "browser_step",
            input: { action: "goto", url: "http://example.com" },
            success: true,
            url_after: "http://example.com/",
            timestamp: "2026-01-15T10:30:01Z",
          },
          {
            type: "http_request",
            input: { method: "GET", url: "http://example.com/api" },
            success: true,
            http_status: 200,
            timestamp: "2026-01-15T10:30:02Z",
          },
        ],
      });

      const result = await server.getHandler("get_exploration_log")({
        session_id: "sess-1",
      });
      const text = result.content[0].text;

      expect(text).toContain("sess-1");
      expect(text).toContain("Actions:** 2");
      expect(text).toContain("[PASS]");
      expect(text).toContain("browser_step");
      expect(text).toContain("http_request");
      expect(text).toContain("HTTP status:** 200");
      expect(text).toContain("Successful browser steps");
    });

    it("shows error details for failed actions", async () => {
      vi.mocked(getExplorationLog).mockReturnValue({
        session_id: "sess-2",
        project_key: "github.com/owner/repo",
        started_at: "2026-01-15T10:30:00Z",
        updated_at: "2026-01-15T10:35:00Z",
        actions: [
          {
            type: "browser_step",
            input: { action: "click", selector: "#missing" },
            success: false,
            error: "Element not found",
            timestamp: "2026-01-15T10:30:01Z",
          },
        ],
      });

      const result = await server.getHandler("get_exploration_log")({
        session_id: "sess-2",
      });
      const text = result.content[0].text;

      expect(text).toContain("[FAIL]");
      expect(text).toContain("Element not found");
    });

    it("shows message when no actions recorded", async () => {
      vi.mocked(getExplorationLog).mockReturnValue({
        session_id: "sess-3",
        project_key: "github.com/owner/repo",
        started_at: "2026-01-15T10:30:00Z",
        updated_at: "2026-01-15T10:30:00Z",
        actions: [],
      });

      const result = await server.getHandler("get_exploration_log")({
        session_id: "sess-3",
      });
      const text = result.content[0].text;

      expect(text).toContain("No actions recorded");
    });
  });
});
