import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ServerCredential {
  api_key: string;
  user_id: string;
}

export type CredentialsStore = Record<string, ServerCredential>;

const CREDENTIALS_DIR = join(homedir(), ".aqua");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export function loadCredentials(): CredentialsStore {
  if (!existsSync(CREDENTIALS_FILE)) {
    return {};
  }
  const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
  return JSON.parse(raw) as CredentialsStore;
}

export function saveCredentials(store: CredentialsStore): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(store, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function getCredential(serverURL: string): ServerCredential | null {
  const store = loadCredentials();
  const normalized = serverURL.replace(/\/$/, "");
  return store[normalized] ?? null;
}

export function setCredential(
  serverURL: string,
  credential: ServerCredential
): void {
  const store = loadCredentials();
  const normalized = serverURL.replace(/\/$/, "");
  store[normalized] = credential;
  saveCredentials(store);
}

export function removeCredential(serverURL: string): void {
  const store = loadCredentials();
  const normalized = serverURL.replace(/\/$/, "");
  delete store[normalized];
  saveCredentials(store);
}
