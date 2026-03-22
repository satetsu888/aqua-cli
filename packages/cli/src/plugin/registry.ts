import type { AquaPlugin } from "./interface.js";
import type { Driver } from "../driver/types.js";

const BUILTIN_ACTIONS = new Set(["http_request", "browser"]);

export class PluginRegistry {
  private plugins = new Map<string, AquaPlugin>();
  private driverCache = new Map<string, Driver>();

  register(plugin: AquaPlugin): void {
    if (BUILTIN_ACTIONS.has(plugin.actionType)) {
      throw new Error(
        `Cannot override built-in action "${plugin.actionType}"`
      );
    }
    if (this.plugins.has(plugin.actionType)) {
      throw new Error(
        `Action type "${plugin.actionType}" is already registered by plugin "${this.plugins.get(plugin.actionType)!.name}"`
      );
    }
    this.plugins.set(plugin.actionType, plugin);
  }

  getPlugin(actionType: string): AquaPlugin | undefined {
    return this.plugins.get(actionType);
  }

  getAllPlugins(): AquaPlugin[] {
    return Array.from(this.plugins.values());
  }

  hasPlugins(): boolean {
    return this.plugins.size > 0;
  }

  /**
   * Get or create a driver for the given action type.
   * Drivers are cached per scenario (call clearDriverCache() between scenarios).
   */
  async getOrCreateDriver(
    actionType: string,
    variables: Record<string, string>
  ): Promise<Driver> {
    const cached = this.driverCache.get(actionType);
    if (cached) return cached;

    const plugin = this.plugins.get(actionType);
    if (!plugin) {
      throw new Error(
        `Unknown action type: "${actionType}". Is the plugin installed and configured in .aqua/config.json?`
      );
    }

    const driver = await plugin.createDriver(variables);
    this.driverCache.set(actionType, driver);
    return driver;
  }

  /** Clear cached drivers (call between scenarios). */
  clearDriverCache(): void {
    this.driverCache.clear();
  }

  /** Get action descriptions for MCP instructions. */
  getActionDescriptions(): string {
    if (this.plugins.size === 0) return "";

    const lines = Array.from(this.plugins.values()).map(
      (p) => `- ${p.actionType}: [plugin] ${p.actionDescription}`
    );
    return lines.join("\n");
  }
}
