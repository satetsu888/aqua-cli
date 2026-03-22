import { execSync } from "node:child_process";
import { loadConfig, saveConfig } from "../config/index.js";
import { getProjectRoot } from "../config/projectRoot.js";

/**
 * Add a plugin: install the npm package and add to .aqua/config.json plugins array.
 */
export async function runPluginAdd(packageName: string): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(
      "Project not initialized. Run `aqua-cli init` first."
    );
    process.exit(1);
  }

  const plugins = config.plugins ?? [];
  if (plugins.includes(packageName)) {
    console.log(`Plugin "${packageName}" is already configured.`);
    return;
  }

  // Install the npm package
  console.log(`Installing ${packageName}...`);
  try {
    execSync(`npm install ${packageName}`, {
      cwd: getProjectRoot(),
      stdio: "inherit",
    });
  } catch {
    console.error(`Failed to install "${packageName}".`);
    process.exit(1);
  }

  // Add to config
  config.plugins = [...plugins, packageName];
  saveConfig(config);
  console.log(`Plugin "${packageName}" added to .aqua/config.json`);
}

/**
 * Remove a plugin: remove from .aqua/config.json plugins array and uninstall the npm package.
 */
export async function runPluginRemove(packageName: string): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(
      "Project not initialized. Run `aqua-cli init` first."
    );
    process.exit(1);
  }

  const plugins = config.plugins ?? [];
  if (!plugins.includes(packageName)) {
    console.error(`Plugin "${packageName}" is not configured.`);
    process.exit(1);
  }

  // Remove from config
  config.plugins = plugins.filter((p) => p !== packageName);
  if (config.plugins.length === 0) {
    delete config.plugins;
  }
  saveConfig(config);
  console.log(`Plugin "${packageName}" removed from .aqua/config.json`);

  // Uninstall the npm package
  console.log(`Uninstalling ${packageName}...`);
  try {
    execSync(`npm uninstall ${packageName}`, {
      cwd: getProjectRoot(),
      stdio: "inherit",
    });
  } catch {
    console.warn(
      `Warning: Failed to uninstall "${packageName}". You may need to remove it manually.`
    );
  }
}

/**
 * List configured plugins.
 */
export function runPluginList(): void {
  const config = loadConfig();
  const plugins = config?.plugins ?? [];

  if (plugins.length === 0) {
    console.log("No plugins configured.");
    return;
  }

  console.log("Configured plugins:");
  for (const name of plugins) {
    console.log(`  - ${name}`);
  }
}
