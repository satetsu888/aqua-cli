import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ExplorationLogAction {
  type: "browser_step" | "http_request" | "browser_assertion";
  input: unknown;
  success: boolean;
  error?: string;
  url_after?: string;
  http_status?: number;
  timestamp: string;
}

export interface ExplorationLog {
  session_id: string;
  project_key: string;
  started_at: string;
  updated_at: string;
  actions: ExplorationLogAction[];
}

const EXPLORATIONS_DIR = join(homedir(), ".aqua", "explorations");
const MAX_FILES_PER_PROJECT = 30;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

export function sanitizeProjectKey(projectKey: string): string {
  return projectKey.replace(/\//g, "_");
}

function getLogDir(projectKey?: string): string {
  const dirName = projectKey ? sanitizeProjectKey(projectKey) : "_no_project";
  return join(EXPLORATIONS_DIR, dirName);
}

function getLogPath(sessionId: string, projectKey?: string): string {
  return join(getLogDir(projectKey), `${sessionId}.json`);
}

export function createExplorationLog(
  sessionId: string,
  projectKey?: string,
): void {
  const dir = getLogDir(projectKey);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const now = new Date().toISOString();
  const log: ExplorationLog = {
    session_id: sessionId,
    project_key: projectKey ?? "",
    started_at: now,
    updated_at: now,
    actions: [],
  };

  writeFileSync(getLogPath(sessionId, projectKey), JSON.stringify(log, null, 2) + "\n");
}

export function appendExplorationAction(
  sessionId: string,
  action: ExplorationLogAction,
  projectKey?: string,
): void {
  const path = getLogPath(sessionId, projectKey);
  if (!existsSync(path)) {
    return;
  }

  const log = JSON.parse(readFileSync(path, "utf-8")) as ExplorationLog;
  log.actions.push(action);
  log.updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(log, null, 2) + "\n");
}

export function listExplorationLogs(
  projectKey?: string,
  limit = 10,
): ExplorationLog[] {
  const dir = getLogDir(projectKey);
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const path = join(dir, f);
      try {
        return JSON.parse(readFileSync(path, "utf-8")) as ExplorationLog;
      } catch {
        return null;
      }
    })
    .filter((log): log is ExplorationLog => log !== null);

  // Sort by updated_at descending (most recent first)
  files.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  return files.slice(0, limit);
}

export function getExplorationLog(
  sessionId: string,
  projectKey?: string,
): ExplorationLog | null {
  const path = getLogPath(sessionId, projectKey);
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ExplorationLog;
  } catch {
    return null;
  }
}

function cleanupDirectory(dirPath: string): void {
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  const now = Date.now();

  const fileInfos = files
    .map((f) => {
      const path = join(dirPath, f);
      try {
        const log = JSON.parse(readFileSync(path, "utf-8")) as ExplorationLog;
        return { path, updatedAt: new Date(log.updated_at).getTime() };
      } catch {
        try { unlinkSync(path); } catch { /* ignore */ }
        return null;
      }
    })
    .filter((info): info is NonNullable<typeof info> => info !== null);

  // Sort by updatedAt descending (newest first)
  fileInfos.sort((a, b) => b.updatedAt - a.updatedAt);

  for (let i = 0; i < fileInfos.length; i++) {
    const info = fileInfos[i];
    if (now - info.updatedAt > MAX_AGE_MS || i >= MAX_FILES_PER_PROJECT) {
      try { unlinkSync(info.path); } catch { /* ignore */ }
    }
  }

  // Remove directory if empty
  try {
    const remaining = readdirSync(dirPath);
    if (remaining.length === 0) {
      rmSync(dirPath, { recursive: true });
    }
  } catch { /* ignore */ }
}

export function cleanupExplorationLogs(projectKey?: string): void {
  const dir = getLogDir(projectKey);
  if (!existsSync(dir)) {
    return;
  }
  cleanupDirectory(dir);
}

export function cleanupAllExplorationLogs(): void {
  if (!existsSync(EXPLORATIONS_DIR)) {
    return;
  }

  try {
    const dirs = readdirSync(EXPLORATIONS_DIR);
    for (const dirName of dirs) {
      const dirPath = join(EXPLORATIONS_DIR, dirName);
      try {
        cleanupDirectory(dirPath);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
