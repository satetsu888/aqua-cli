import { describe, it, expect, vi, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { getProjectRoot } from "./projectRoot.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("getProjectRoot", () => {
  afterEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it("returns git repository root when in a git repo", () => {
    vi.mocked(execSync).mockReturnValue("/home/user/my-project\n");
    expect(getProjectRoot()).toBe("/home/user/my-project");
    expect(execSync).toHaveBeenCalledWith("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("falls back to process.cwd() when not in a git repo", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not a git repository");
    });
    expect(getProjectRoot()).toBe(process.cwd());
  });
});
