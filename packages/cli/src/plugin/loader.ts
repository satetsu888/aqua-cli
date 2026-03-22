import { loadConfig } from "../config/index.js";
import type { PluginRegistry } from "./registry.js";
import type { AquaPlugin } from "./interface.js";

/**
 * Load plugins declared in .aqua/config.json.
 * Plugin loading failures are warnings, not errors (QA execution continues).
 */
export async function loadPlugins(
  registry: PluginRegistry
): Promise<void> {
  const config = loadConfig();
  const plugins = config?.plugins;
  if (!plugins || plugins.length === 0) return;

  for (const pluginName of plugins) {
    if (typeof pluginName !== "string") continue;

    try {
      const mod = await import(pluginName);
      const plugin: AquaPlugin = mod.default ?? mod.plugin;

      validatePluginInterface(plugin, pluginName);
      registry.register(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Failed to load plugin "${pluginName}": ${message}`);
    }
  }
}

function validatePluginInterface(plugin: unknown, packageName: string): asserts plugin is AquaPlugin {
  if (!plugin || typeof plugin !== "object") {
    throw new Error(`Plugin "${packageName}" does not export a valid AquaPlugin object`);
  }

  const p = plugin as Record<string, unknown>;

  if (typeof p.name !== "string" || !p.name) {
    throw new Error(`Plugin "${packageName}" is missing required "name" property`);
  }
  if (typeof p.actionType !== "string" || !p.actionType) {
    throw new Error(`Plugin "${packageName}" is missing required "actionType" property`);
  }
  if (typeof p.createDriver !== "function") {
    throw new Error(`Plugin "${packageName}" is missing required "createDriver" method`);
  }
  if (typeof p.actionDescription !== "string") {
    throw new Error(`Plugin "${packageName}" is missing required "actionDescription" property`);
  }
}
