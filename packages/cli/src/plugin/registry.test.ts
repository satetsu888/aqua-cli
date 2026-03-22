import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "./registry.js";
import type { AquaPlugin } from "./interface.js";

function makePlugin(overrides?: Partial<AquaPlugin>): AquaPlugin {
  return {
    name: "@aquaqa/test-plugin",
    actionType: "test_action",
    configSchema: {} as AquaPlugin["configSchema"],
    assertionSchemas: [],
    actionDescription: "Test action for unit tests",
    createDriver: vi.fn().mockResolvedValue({
      execute: vi.fn().mockResolvedValue({
        stepKey: "s1",
        scenarioName: "",
        action: "test_action",
        status: "passed",
        startedAt: new Date(),
        finishedAt: new Date(),
      }),
    }),
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  it("registers and retrieves a plugin", () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin();
    registry.register(plugin);

    expect(registry.getPlugin("test_action")).toBe(plugin);
    expect(registry.getAllPlugins()).toHaveLength(1);
    expect(registry.hasPlugins()).toBe(true);
  });

  it("returns undefined for unknown action type", () => {
    const registry = new PluginRegistry();
    expect(registry.getPlugin("unknown")).toBeUndefined();
  });

  it("reports no plugins when empty", () => {
    const registry = new PluginRegistry();
    expect(registry.hasPlugins()).toBe(false);
    expect(registry.getAllPlugins()).toHaveLength(0);
  });

  it("throws when registering duplicate action type", () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin());

    expect(() => registry.register(makePlugin({ name: "@aquaqa/other" }))).toThrow(
      'Action type "test_action" is already registered'
    );
  });

  it("throws when trying to override built-in action http_request", () => {
    const registry = new PluginRegistry();
    expect(() => registry.register(makePlugin({ actionType: "http_request" }))).toThrow(
      'Cannot override built-in action "http_request"'
    );
  });

  it("throws when trying to override built-in action browser", () => {
    const registry = new PluginRegistry();
    expect(() => registry.register(makePlugin({ actionType: "browser" }))).toThrow(
      'Cannot override built-in action "browser"'
    );
  });

  describe("getOrCreateDriver", () => {
    it("creates a driver on first call", async () => {
      const registry = new PluginRegistry();
      const plugin = makePlugin();
      registry.register(plugin);

      const driver = await registry.getOrCreateDriver("test_action", {});

      expect(plugin.createDriver).toHaveBeenCalledWith({});
      expect(driver).toBeDefined();
    });

    it("caches driver on subsequent calls", async () => {
      const registry = new PluginRegistry();
      const plugin = makePlugin();
      registry.register(plugin);

      const driver1 = await registry.getOrCreateDriver("test_action", {});
      const driver2 = await registry.getOrCreateDriver("test_action", {});

      expect(driver1).toBe(driver2);
      expect(plugin.createDriver).toHaveBeenCalledTimes(1);
    });

    it("clears cache and creates new driver after clearDriverCache", async () => {
      const registry = new PluginRegistry();
      const plugin = makePlugin();
      registry.register(plugin);

      await registry.getOrCreateDriver("test_action", {});
      registry.clearDriverCache();
      await registry.getOrCreateDriver("test_action", {});

      expect(plugin.createDriver).toHaveBeenCalledTimes(2);
    });

    it("throws for unknown action type", async () => {
      const registry = new PluginRegistry();
      await expect(registry.getOrCreateDriver("unknown", {})).rejects.toThrow(
        'Unknown action type: "unknown"'
      );
    });
  });

  describe("getActionDescriptions", () => {
    it("returns empty string when no plugins", () => {
      const registry = new PluginRegistry();
      expect(registry.getActionDescriptions()).toBe("");
    });

    it("returns formatted descriptions for registered plugins", () => {
      const registry = new PluginRegistry();
      registry.register(makePlugin({ actionType: "stripe", actionDescription: "Check Stripe state" }));

      const desc = registry.getActionDescriptions();
      expect(desc).toContain("stripe");
      expect(desc).toContain("[plugin]");
      expect(desc).toContain("Check Stripe state");
    });
  });
});
