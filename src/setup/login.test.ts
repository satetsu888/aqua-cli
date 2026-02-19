import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runLogin, ensureCredential } from "./login.js";
import * as credentials from "../config/credentials.js";

vi.mock("../config/credentials.js", () => ({
  getCredential: vi.fn(),
  setCredential: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(() => ({ unref: () => {} })),
}));

class ExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

describe("runLogin", () => {
  const mockFetch = vi.fn();
  const mockExit = vi
    .spyOn(process, "exit")
    .mockImplementation((code) => {
      throw new ExitError(code as number);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    mockExit.mockClear();
    vi.mocked(credentials.getCredential).mockReset();
    vi.mocked(credentials.setCredential).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exits with error for invalid URL", async () => {
    await expect(runLogin({ serverUrl: "ftp://bad-url" })).rejects.toThrow(
      ExitError
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("skips authentication when already authenticated without --force", async () => {
    vi.mocked(credentials.getCredential).mockReturnValue({
      api_key: "existing-key123",
      user_id: "u1",
    });

    await runLogin({ serverUrl: "http://localhost:9080" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("re-authenticates with --force even when already authenticated", async () => {
    vi.mocked(credentials.getCredential).mockReturnValue({
      api_key: "existing-key123",
      user_id: "u1",
    });
    // Mock browser auth init
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          token: "cli-token",
          browser_url: "http://localhost:9080/auth/login?token=cli-token",
        }),
    });
    // Mock poll response - completed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          status: "completed",
          user: { id: "u2", email: "test@example.com" },
          api_key: "new-key-123456789",
        }),
    });

    const promise = runLogin({
      serverUrl: "http://localhost:9080",
      force: true,
    });
    // Attach handler before advancing timers to avoid unhandled rejection
    const settled = promise.then(() => "resolved", () => "rejected");
    await vi.advanceTimersByTimeAsync(3000);
    await settled;
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9080/auth/cli-login",
      { method: "POST" }
    );
    expect(credentials.setCredential).toHaveBeenCalledWith(
      "http://localhost:9080",
      { api_key: "new-key-123456789", user_id: "u2" }
    );
  });

  it("exits on browser auth 410 Gone", async () => {
    vi.mocked(credentials.getCredential).mockReturnValue(null);
    // Init succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          token: "t",
          browser_url: "http://localhost/auth?t=t",
        }),
    });
    // Poll returns 410
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 410,
    });

    const promise = runLogin({ serverUrl: "http://localhost:9080" });
    // Attach rejection handler before advancing to avoid unhandled rejection
    const expectation = expect(promise).rejects.toThrow(ExitError);
    await vi.advanceTimersByTimeAsync(3000);
    await expectation;
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("ensureCredential", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    vi.mocked(credentials.getCredential).mockReset();
    vi.mocked(credentials.setCredential).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("returns existing credential when present", () => {
    vi.mocked(credentials.getCredential).mockReturnValue({
      api_key: "key1",
      user_id: "u1",
    });
    const result = ensureCredential("http://localhost:9080");
    expect(result).toEqual({ api_key: "key1", user_id: "u1" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws error when no credential exists", () => {
    vi.mocked(credentials.getCredential).mockReturnValue(null);

    expect(() => ensureCredential("http://localhost:9080")).toThrow(
      "Not logged in. Run 'aqua-cli login' first to authenticate."
    );
  });
});
