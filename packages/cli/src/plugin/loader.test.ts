import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadPlugins } from "./loader.js";
import { PluginRegistry } from "./registry.js";

vi.mock("../config/index.js", () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from "../config/index.js";

beforeEach(() => {
  vi.mocked(loadConfig).mockReset();
});

describe("loadPlugins", () => {
  it("does nothing when config has no plugins", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
    });

    const registry = new PluginRegistry();
    await loadPlugins(registry);

    expect(registry.hasPlugins()).toBe(false);
  });

  it("does nothing when config is null", async () => {
    vi.mocked(loadConfig).mockReturnValue(null);

    const registry = new PluginRegistry();
    await loadPlugins(registry);

    expect(registry.hasPlugins()).toBe(false);
  });

  it("does nothing when plugins array is empty", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: [],
    } as ReturnType<typeof loadConfig>);

    const registry = new PluginRegistry();
    await loadPlugins(registry);

    expect(registry.hasPlugins()).toBe(false);
  });

  it("warns and continues when plugin fails to load", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: ["@nonexistent/plugin"],
    } as ReturnType<typeof loadConfig>);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const registry = new PluginRegistry();
    await loadPlugins(registry);

    expect(registry.hasPlugins()).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load plugin "@nonexistent/plugin"')
    );

    warnSpy.mockRestore();
  });

  it("skips non-string entries in plugins array", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      server_url: "http://localhost:9080",
      plugins: [123, null, undefined],
    } as ReturnType<typeof loadConfig>);

    const registry = new PluginRegistry();
    await loadPlugins(registry);

    expect(registry.hasPlugins()).toBe(false);
  });
});
