import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerRecorderTools } from "./recorder.js";

vi.mock("../../recorder/recorder.js", () => ({
  recordBrowserActions: vi.fn(),
}));

import { recordBrowserActions } from "../../recorder/recorder.js";

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

describe("recorder tools", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(recordBrowserActions).mockReset();
    registerRecorderTools(server as never);
  });

  it("registers record_browser_actions tool", () => {
    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.getHandler("record_browser_actions")).toBeDefined();
  });

  describe("record_browser_actions", () => {
    it("returns recorded steps", async () => {
      vi.mocked(recordBrowserActions).mockResolvedValue({
        steps: [
          { goto: "http://example.com" },
          { click: "#login" },
        ],
        rawCode: "await page.goto('http://example.com');",
        warnings: [],
        inputVariables: [],
      });

      const result = await server.getHandler("record_browser_actions")({});
      const text = result.content[0].text;

      expect(text).toContain("Recorded Browser Actions");
      expect(text).toContain("2 step(s) recorded");
      expect(text).toContain("http://example.com");
      expect(recordBrowserActions).toHaveBeenCalledWith({ url: undefined });
    });

    it("passes url parameter", async () => {
      vi.mocked(recordBrowserActions).mockResolvedValue({
        steps: [],
        rawCode: "",
        warnings: [],
        inputVariables: [],
      });

      await server.getHandler("record_browser_actions")({
        url: "http://example.com/login",
      });

      expect(recordBrowserActions).toHaveBeenCalledWith({
        url: "http://example.com/login",
      });
    });

    it("shows warnings when present", async () => {
      vi.mocked(recordBrowserActions).mockResolvedValue({
        steps: [{ goto: "http://example.com" }],
        rawCode: "await page.goto('http://example.com');",
        warnings: ["Unsupported action skipped"],
        inputVariables: [],
      });

      const result = await server.getHandler("record_browser_actions")({});
      const text = result.content[0].text;

      expect(text).toContain("Warnings");
      expect(text).toContain("Unsupported action skipped");
    });

    it("shows input variables when present", async () => {
      vi.mocked(recordBrowserActions).mockResolvedValue({
        steps: [
          { type: { selector: "#email", text: "{{email}}" } },
        ],
        rawCode: "await page.getByLabel('Email').fill('test@example.com');",
        warnings: [],
        inputVariables: ["email", "password"],
      });

      const result = await server.getHandler("record_browser_actions")({});
      const text = result.content[0].text;

      expect(text).toContain("Input Variables");
      expect(text).toContain("{{email}}");
      expect(text).toContain("{{password}}");
    });

    it("shows message when no actions recorded", async () => {
      vi.mocked(recordBrowserActions).mockResolvedValue({
        steps: [],
        rawCode: "",
        warnings: [],
        inputVariables: [],
      });

      const result = await server.getHandler("record_browser_actions")({});
      const text = result.content[0].text;

      expect(text).toContain("No actions were recorded");
    });

    it("returns error when recording fails", async () => {
      vi.mocked(recordBrowserActions).mockRejectedValue(
        new Error("Playwright not installed")
      );

      const result = await server.getHandler("record_browser_actions")({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Playwright not installed");
    });
  });
});
