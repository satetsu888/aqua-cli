import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadConfig,
  saveConfig,
  resolveServerURL,
  DEFAULT_SERVER_URL,
} from "./index.js";
import * as fs from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("./projectRoot.js", () => ({
  getProjectRoot: () => "/mock/project",
}));

describe("loadConfig", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it("returns parsed config when file exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ server_url: "http://localhost:9080", project_id: "p1" })
    );
    const config = loadConfig();
    expect(config).toEqual({
      server_url: "http://localhost:9080",
      project_id: "p1",
    });
  });

  it("returns null when file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config).toBeNull();
  });
});

describe("saveConfig", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
  });

  it("creates directory if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    saveConfig({ server_url: "http://localhost:9080" });
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".aqua"),
      { recursive: true }
    );
  });

  it("writes config as JSON", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    saveConfig({ server_url: "http://localhost:9080", project_id: "p1" });
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(JSON.parse(written)).toEqual({
      server_url: "http://localhost:9080",
      project_id: "p1",
    });
  });
});

describe("resolveServerURL", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it("returns environment variable when set", () => {
    process.env.AQUA_SERVER_URL = "http://env-server:9090";
    expect(resolveServerURL()).toBe("http://env-server:9090");
  });

  it("returns config file value when no flag or env var", () => {
    delete process.env.AQUA_SERVER_URL;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ server_url: "http://config:9080" })
    );
    expect(resolveServerURL()).toBe("http://config:9080");
  });

  it("returns default when nothing else is available", () => {
    delete process.env.AQUA_SERVER_URL;
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(resolveServerURL()).toBe(DEFAULT_SERVER_URL);
  });
});
