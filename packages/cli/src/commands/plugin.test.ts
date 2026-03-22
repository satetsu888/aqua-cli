import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPluginAdd, runPluginRemove, runPluginList } from "./plugin.js";

vi.mock("../config/index.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock("../config/projectRoot.js", () => ({
  getProjectRoot: vi.fn().mockReturnValue("/mock/project"),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { loadConfig, saveConfig } from "../config/index.js";
import { execSync } from "node:child_process";

beforeEach(() => {
  vi.mocked(loadConfig).mockReset();
  vi.mocked(saveConfig).mockReset();
  vi.mocked(execSync).mockReset();
});

describe("runPluginAdd", () => {
  it("installs package and adds to config", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      project_key: "github.com/owner/repo",
    });

    await runPluginAdd("@aquaqa/stripe-plugin");

    expect(execSync).toHaveBeenCalledWith(
      "npm install @aquaqa/stripe-plugin",
      expect.objectContaining({ cwd: "/mock/project" }),
    );
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: ["@aquaqa/stripe-plugin"],
      }),
    );
  });

  it("appends to existing plugins", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: ["@aquaqa/other-plugin"],
    });

    await runPluginAdd("@aquaqa/stripe-plugin");

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: ["@aquaqa/other-plugin", "@aquaqa/stripe-plugin"],
      }),
    );
  });

  it("skips if plugin already configured", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: ["@aquaqa/stripe-plugin"],
    });

    await runPluginAdd("@aquaqa/stripe-plugin");

    expect(execSync).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("exits if config does not exist", async () => {
    vi.mocked(loadConfig).mockReturnValue(null);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(runPluginAdd("@aquaqa/stripe-plugin")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

describe("runPluginRemove", () => {
  it("removes from config and uninstalls package", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: ["@aquaqa/stripe-plugin", "@aquaqa/other"],
    });

    await runPluginRemove("@aquaqa/stripe-plugin");

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: ["@aquaqa/other"],
      }),
    );
    expect(execSync).toHaveBeenCalledWith(
      "npm uninstall @aquaqa/stripe-plugin",
      expect.objectContaining({ cwd: "/mock/project" }),
    );
  });

  it("removes plugins field when last plugin removed", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: ["@aquaqa/stripe-plugin"],
    });

    await runPluginRemove("@aquaqa/stripe-plugin");

    const savedConfig = vi.mocked(saveConfig).mock.calls[0][0];
    expect(savedConfig.plugins).toBeUndefined();
  });

  it("exits if plugin not configured", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: [],
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(runPluginRemove("@aquaqa/stripe-plugin")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

describe("runPluginList", () => {
  it("lists configured plugins", () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: ["@aquaqa/stripe-plugin", "@aquaqa/other"],
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    runPluginList();

    expect(logSpy.mock.calls.flat().join("\n")).toContain("@aquaqa/stripe-plugin");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("@aquaqa/other");

    logSpy.mockRestore();
  });

  it("shows message when no plugins", () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    runPluginList();

    expect(logSpy.mock.calls.flat().join("\n")).toContain("No plugins configured");

    logSpy.mockRestore();
  });
});
