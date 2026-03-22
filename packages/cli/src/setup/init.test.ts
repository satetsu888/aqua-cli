import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInit } from "./init.js";
import * as login from "./login.js";
import * as config from "../config/index.js";
import * as git from "./git.js";
import * as prompts from "./prompts.js";
import { AquaClient } from "../api/client.js";

vi.mock("./login.js", () => ({
  ensureCredential: vi.fn(),
}));

vi.mock("../config/index.js", () => ({
  saveConfig: vi.fn(),
  loadConfig: vi.fn(),
  resolveServerURL: vi.fn(),
  DEFAULT_SERVER_URL: "http://localhost:9080",
}));

vi.mock("./git.js", () => ({
  detectGitRemote: vi.fn(),
  normalizeProjectKey: vi.fn(),
  generateLocalProjectKey: vi.fn(),
}));

vi.mock("./prompts.js", () => ({
  promptText: vi.fn(),
  promptSelect: vi.fn(),
  promptConfirm: vi.fn(),
  closePrompts: vi.fn(),
}));

vi.mock("../config/projectRoot.js", () => ({
  getProjectRoot: vi.fn().mockReturnValue("/fake/project"),
}));

vi.mock("../api/client.js", () => {
  return {
    AquaClient: vi.fn(function () {}),
  };
});

class ExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

describe("runInit", () => {
  const mockExit = vi
    .spyOn(process, "exit")
    .mockImplementation((code) => {
      throw new ExitError(code as number);
    });

  let mockClient: {
    listOrganizations: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockExit.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockClient = {
      listOrganizations: vi.fn().mockResolvedValue([]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(AquaClient).mockImplementation((() => mockClient) as any);

    vi.mocked(login.ensureCredential).mockReturnValue({
      api_key: "test-key",
      user_id: "u1",
    });
    vi.mocked(git.detectGitRemote).mockReturnValue(null);
    vi.mocked(git.generateLocalProjectKey).mockReturnValue("local/project-abc123");
    vi.mocked(prompts.closePrompts).mockImplementation(() => {});
  });

  it("exits with error for invalid URL", async () => {
    await expect(runInit({ serverUrl: "ftp://bad" })).rejects.toThrow(
      ExitError
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits on 401 auth error", async () => {
    mockClient.listOrganizations.mockRejectedValue(
      new Error("API error 401: Unauthorized")
    );
    await expect(
      runInit({ serverUrl: "http://localhost:9080" })
    ).rejects.toThrow(ExitError);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("generates project_key from git remote", async () => {
    vi.mocked(git.detectGitRemote).mockReturnValue({
      rawURL: "git@github.com:owner/repo.git",
      ownerRepo: "owner/repo",
    });
    vi.mocked(git.normalizeProjectKey).mockReturnValue("github.com/owner/repo");

    await runInit({ serverUrl: "http://localhost:9080" });

    expect(config.saveConfig).toHaveBeenCalledWith({
      server_url: "http://localhost:9080",
      project_key: "github.com/owner/repo",
    });
  });

  it("generates local project_key when no git remote", async () => {
    vi.mocked(git.detectGitRemote).mockReturnValue(null);

    await runInit({ serverUrl: "http://localhost:9080" });

    expect(git.generateLocalProjectKey).toHaveBeenCalledWith("project");
    expect(config.saveConfig).toHaveBeenCalledWith({
      server_url: "http://localhost:9080",
      project_key: "local/project-abc123",
    });
  });

  it("does not select org or project interactively", async () => {
    vi.mocked(git.detectGitRemote).mockReturnValue(null);

    await runInit({ serverUrl: "http://localhost:9080" });

    expect(prompts.promptSelect).not.toHaveBeenCalled();
    expect(prompts.promptText).not.toHaveBeenCalled();
  });

  it("always calls closePrompts in finally", async () => {
    mockClient.listOrganizations.mockRejectedValue(new Error("network error"));

    await expect(
      runInit({ serverUrl: "http://localhost:9080" })
    ).rejects.toThrow("network error");

    expect(prompts.closePrompts).toHaveBeenCalled();
  });

  it("calls closePrompts on normal completion", async () => {
    vi.mocked(git.detectGitRemote).mockReturnValue(null);

    await runInit({ serverUrl: "http://localhost:9080" });

    expect(prompts.closePrompts).toHaveBeenCalled();
  });
});
