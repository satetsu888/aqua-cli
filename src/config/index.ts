import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getProjectRoot } from "./projectRoot.js";

export interface AquaConfig {
  server_url: string;
  project_key?: string;
  /** @deprecated Use project_key instead. Kept for migration from old config format. */
  organization_id?: string;
  /** @deprecated Use project_key instead. Kept for migration from old config format. */
  project_id?: string;
}

const CONFIG_DIR = ".aqua";
const CONFIG_FILE = "config.json";
export const DEFAULT_SERVER_URL = "http://localhost:9080";

function configDir(): string {
  return join(getProjectRoot(), CONFIG_DIR);
}

function configPath(): string {
  return join(configDir(), CONFIG_FILE);
}

export function loadConfig(): AquaConfig | null {
  const path = configPath();
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as AquaConfig;
}

export function saveConfig(config: AquaConfig): void {
  const dir = configDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

/**
 * Resolve server URL with priority:
 * 1. CLI flag (explicit --server-url)
 * 2. Environment variable (AQUA_SERVER_URL)
 * 3. .aqua/config.json
 * 4. Default (http://localhost:8080)
 */
export function resolveServerURL(cliFlag?: string): string {
  if (cliFlag) {
    return cliFlag;
  }

  const envURL = process.env.AQUA_SERVER_URL;
  if (envURL) {
    return envURL;
  }

  const config = loadConfig();
  if (config?.server_url) {
    return config.server_url;
  }

  return DEFAULT_SERVER_URL;
}
