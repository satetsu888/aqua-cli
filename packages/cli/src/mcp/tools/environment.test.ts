import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerEnvironmentTools } from "./environment.js";
import * as env from "../../environment/index.js";

vi.mock("../../environment/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../environment/index.js")>();
  return {
    ...actual,
    listEnvironments: vi.fn(),
    validateEnvironment: vi.fn(),
    saveEnvironment: vi.fn(),
  };
});

type ToolCallback = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
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

describe("environment tools", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
    vi.mocked(env.listEnvironments).mockReset();
    vi.mocked(env.validateEnvironment).mockReset();
    vi.mocked(env.saveEnvironment).mockReset();
  });

  describe("list_environments", () => {
    it("returns message when no environments found", async () => {
      vi.mocked(env.listEnvironments).mockResolvedValue([]);
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("list_environments")({});

      expect(result.content[0].text).toContain("No environments found");
    });

    it("lists available environments", async () => {
      vi.mocked(env.listEnvironments).mockResolvedValue([
        { name: "staging" },
        { name: "production" },
      ]);
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("list_environments")({});

      const text = result.content[0].text;
      expect(text).toContain("staging");
      expect(text).toContain("production");
      expect(text).toContain("(no notes)");
    });

    it("lists environments with notes", async () => {
      vi.mocked(env.listEnvironments).mockResolvedValue([
        { name: "local", notes: "- VPN required\n- Test account: test@example.com" },
        { name: "staging" },
      ]);
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("list_environments")({});

      const text = result.content[0].text;
      expect(text).toContain("## local");
      expect(text).toContain("VPN required");
      expect(text).toContain("Test account: test@example.com");
      expect(text).toContain("## staging");
      expect(text).toContain("(no notes)");
    });
  });

  describe("validate_environment", () => {
    it("reports valid environment", async () => {
      vi.mocked(env.validateEnvironment).mockResolvedValue({
        valid: true,
        filePath: "/path/.aqua/environments/staging.json",
        variableKeys: ["api_base_url"],
        secretKeys: ["api_key"],
        issues: [],
      });
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("validate_environment")({
        env_name: "staging",
      });

      const text = result.content[0].text;
      expect(text).toContain("Valid:** Yes");
      expect(text).toContain("api_base_url");
      expect(text).toContain("api_key");
      expect(text).toContain("No issues found");
    });

    it("reports validation issues", async () => {
      vi.mocked(env.validateEnvironment).mockResolvedValue({
        valid: false,
        filePath: "/path/.aqua/environments/broken.json",
        issues: [
          { severity: "error", message: "Invalid schema" },
          { severity: "warning", message: "Unused variable" },
        ],
      });
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("validate_environment")({
        env_name: "broken",
      });

      const text = result.content[0].text;
      expect(text).toContain("Valid:** No");
      expect(text).toContain("[ERROR]");
      expect(text).toContain("[WARN]");
    });
  });

  describe("create_environment", () => {
    it("creates environment file", async () => {
      vi.mocked(env.saveEnvironment).mockResolvedValue(
        "/project/.aqua/environments/staging.json"
      );
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("create_environment")({
        env_name: "staging",
        variables: { api_base_url: "http://localhost:3000" },
        secrets: { api_key: { type: "literal", value: "key-123" } },
      });

      expect(result.content[0].text).toContain("staging");
      expect(result.content[0].text).toContain("created");
      expect(env.saveEnvironment).toHaveBeenCalledWith("staging", {
        variables: { api_base_url: "http://localhost:3000" },
        secrets: { api_key: { type: "literal", value: "key-123" } },
      });
    });

    it("creates environment file with notes", async () => {
      vi.mocked(env.saveEnvironment).mockResolvedValue(
        "/project/.aqua/environments/local.json"
      );
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("create_environment")({
        env_name: "local",
        notes: "- VPN required\n- DB tests not available",
        variables: { api_base_url: "http://localhost:8080" },
      });

      expect(result.content[0].text).toContain("local");
      expect(result.content[0].text).toContain("created");
      expect(env.saveEnvironment).toHaveBeenCalledWith("local", {
        notes: "- VPN required\n- DB tests not available",
        variables: { api_base_url: "http://localhost:8080" },
      });
    });

    it("returns error on failure", async () => {
      vi.mocked(env.saveEnvironment).mockRejectedValue(
        new Error("Permission denied")
      );
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("create_environment")({
        env_name: "staging",
      });

      expect(result.content[0].text).toContain("Permission denied");
    });

    it("creates environment with proxy configuration", async () => {
      vi.mocked(env.saveEnvironment).mockResolvedValue(
        "/project/.aqua/environments/corp.json"
      );
      registerEnvironmentTools(server as never);

      const proxy = {
        server: "http://proxy.corp.com:3128",
        bypass: "localhost,.internal.com",
        username: { type: "literal", value: "user" },
        password: { type: "env", value: "PROXY_PASS" },
      };

      const result = await server.getHandler("create_environment")({
        env_name: "corp",
        variables: { api_url: "http://api.corp.com" },
        proxy,
      });

      expect(result.content[0].text).toContain("corp");
      expect(result.content[0].text).toContain("created");
      expect(env.saveEnvironment).toHaveBeenCalledWith("corp", {
        variables: { api_url: "http://api.corp.com" },
        proxy,
      });
    });

    it("creates environment with proxy only", async () => {
      vi.mocked(env.saveEnvironment).mockResolvedValue(
        "/project/.aqua/environments/proxy-only.json"
      );
      registerEnvironmentTools(server as never);

      const result = await server.getHandler("create_environment")({
        env_name: "proxy-only",
        proxy: { server: "http://proxy:3128" },
      });

      expect(result.content[0].text).toContain("created");
      expect(env.saveEnvironment).toHaveBeenCalledWith("proxy-only", {
        proxy: { server: "http://proxy:3128" },
      });
    });
  });
});
