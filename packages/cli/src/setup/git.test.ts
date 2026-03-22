import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectGitRemote,
  detectCurrentBranch,
  detectPullRequestURL,
} from "./git.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("detectGitRemote", () => {
  it("parses SSH format URL", () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      "git@github.com:owner/repo.git\n"
    );
    const result = detectGitRemote();
    expect(result).toEqual({
      rawURL: "git@github.com:owner/repo.git",
      ownerRepo: "owner/repo",
    });
  });

  it("parses HTTPS format URL", () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      "https://github.com/owner/repo.git\n"
    );
    const result = detectGitRemote();
    expect(result).toEqual({
      rawURL: "https://github.com/owner/repo.git",
      ownerRepo: "owner/repo",
    });
  });

  it("parses SSH URL format (ssh://)", () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      "ssh://git@github.com/owner/repo.git\n"
    );
    const result = detectGitRemote();
    expect(result).toEqual({
      rawURL: "ssh://git@github.com/owner/repo.git",
      ownerRepo: "owner/repo",
    });
  });

  it("handles URL without .git suffix", () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      "git@github.com:owner/repo\n"
    );
    const result = detectGitRemote();
    expect(result).toEqual({
      rawURL: "git@github.com:owner/repo",
      ownerRepo: "owner/repo",
    });
  });

  it("returns null when git remote fails", () => {
    vi.mocked(child_process.execSync).mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(detectGitRemote()).toBeNull();
  });

  it("returns null when origin is empty", () => {
    vi.mocked(child_process.execSync).mockReturnValue("\n");
    expect(detectGitRemote()).toBeNull();
  });
});

describe("detectCurrentBranch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the current branch name", () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce("feature/login\n");
    expect(detectCurrentBranch()).toBe("feature/login");
  });

  it("trims whitespace", () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce("  main  \n");
    expect(detectCurrentBranch()).toBe("main");
  });

  it("returns null when git command fails", () => {
    vi.mocked(child_process.execSync).mockImplementationOnce(() => {
      throw new Error("not a git repository");
    });
    expect(detectCurrentBranch()).toBeNull();
  });

  it("returns null when output is empty", () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce("");
    expect(detectCurrentBranch()).toBeNull();
  });
});

describe("detectPullRequestURL", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the PR URL from gh CLI", () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce(
      "https://github.com/owner/repo/pull/42\n"
    );
    expect(detectPullRequestURL()).toBe(
      "https://github.com/owner/repo/pull/42"
    );
  });

  it("returns null when gh CLI is not installed", () => {
    vi.mocked(child_process.execSync).mockImplementationOnce(() => {
      throw new Error("command not found: gh");
    });
    expect(detectPullRequestURL()).toBeNull();
  });

  it("returns null when no PR exists for current branch", () => {
    vi.mocked(child_process.execSync).mockImplementationOnce(() => {
      throw new Error("no pull requests found");
    });
    expect(detectPullRequestURL()).toBeNull();
  });

  it("returns null when output is empty", () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce("");
    expect(detectPullRequestURL()).toBeNull();
  });
});
