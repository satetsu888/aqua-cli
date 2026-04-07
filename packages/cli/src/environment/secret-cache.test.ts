import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSecretCacheKey,
  getCachedSecret,
  setCachedSecret,
  clearSecretCache,
  warmSecretCache,
} from "./secret-cache.js";
import type { SecretEntry } from "./types.js";

vi.mock("../config/projectRoot.js", () => ({
  getProjectRoot: vi.fn(() => "/mock/project"),
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("./resolver-registry.js", () => ({
  getResolver: vi.fn(),
}));

import { getProjectRoot } from "../config/projectRoot.js";
import { readdir, readFile } from "node:fs/promises";
import { getResolver } from "./resolver-registry.js";

describe("buildSecretCacheKey", () => {
  it("builds key for op entry", () => {
    const entry: SecretEntry = { type: "op", value: "op://vault/item/field" };
    const key = buildSecretCacheKey(entry);
    expect(JSON.parse(key)).toEqual({ type: "op", value: "op://vault/item/field" });
  });

  it("builds key for aws_sm entry with region and json_key", () => {
    const entry: SecretEntry = {
      type: "aws_sm",
      value: "prod/db-creds",
      region: "us-east-1",
      json_key: "password",
    };
    const key = buildSecretCacheKey(entry);
    expect(JSON.parse(key)).toEqual({
      type: "aws_sm",
      value: "prod/db-creds",
      region: "us-east-1",
      json_key: "password",
    });
  });

  it("includes providerConfig when present", () => {
    const entry: SecretEntry = { type: "op", value: "op://vault/item/field" };
    const key = buildSecretCacheKey(entry, { profile: "staging" });
    expect(JSON.parse(key)).toEqual({
      type: "op",
      value: "op://vault/item/field",
      provider: { profile: "staging" },
    });
  });

  it("omits providerConfig when empty", () => {
    const entry: SecretEntry = { type: "op", value: "op://vault/item/field" };
    const key = buildSecretCacheKey(entry, {});
    expect(JSON.parse(key)).toEqual({ type: "op", value: "op://vault/item/field" });
  });

  it("builds key for hcv entry with field and mount", () => {
    const entry: SecretEntry = {
      type: "hcv",
      value: "myapp/staging/keys",
      field: "signing_key",
      mount: "kv",
    };
    const key = buildSecretCacheKey(entry);
    expect(JSON.parse(key)).toEqual({
      type: "hcv",
      value: "myapp/staging/keys",
      field: "signing_key",
      mount: "kv",
    });
  });
});

describe("getCachedSecret / setCachedSecret", () => {
  beforeEach(() => {
    clearSecretCache();
    delete process.env.AQUA_DESKTOP_SOCKET;
  });

  it("returns undefined for cache miss", async () => {
    const entry: SecretEntry = { type: "op", value: "op://vault/item/field" };
    expect(await getCachedSecret(entry)).toBeUndefined();
  });

  it("returns cached value after set", async () => {
    const entry: SecretEntry = { type: "op", value: "op://vault/item/field" };
    setCachedSecret(entry, undefined, "resolved-value");
    expect(await getCachedSecret(entry)).toBe("resolved-value");
  });

  it("returns undefined for literal type (not cached)", async () => {
    const entry: SecretEntry = { type: "literal", value: "plain-value" };
    setCachedSecret(entry, undefined, "plain-value");
    expect(await getCachedSecret(entry)).toBeUndefined();
  });

  it("returns undefined for env type (not cached)", async () => {
    const entry: SecretEntry = { type: "env", value: "MY_VAR" };
    setCachedSecret(entry, undefined, "env-value");
    expect(await getCachedSecret(entry)).toBeUndefined();
  });

  it("distinguishes entries with different providerConfig", async () => {
    const entry: SecretEntry = { type: "op", value: "op://vault/item/field" };
    setCachedSecret(entry, undefined, "value-no-provider");
    setCachedSecret(entry, { profile: "staging" }, "value-with-provider");
    expect(await getCachedSecret(entry)).toBe("value-no-provider");
    expect(await getCachedSecret(entry, { profile: "staging" })).toBe("value-with-provider");
  });
});

describe("warmSecretCache", () => {
  beforeEach(() => {
    clearSecretCache();
    vi.mocked(getProjectRoot).mockReturnValue("/mock/project");
    vi.mocked(readdir).mockReset();
    vi.mocked(readFile).mockReset();
    vi.mocked(getResolver).mockReset();
  });

  it("returns zeros when no environment files exist", async () => {
    vi.mocked(readdir).mockResolvedValue([]);
    const result = await warmSecretCache();
    expect(result).toEqual({ resolved: 0, failed: 0 });
  });

  it("returns zeros when environments directory does not exist", async () => {
    vi.mocked(readdir).mockRejectedValue(new Error("ENOENT"));
    const result = await warmSecretCache();
    expect(result).toEqual({ resolved: 0, failed: 0 });
  });

  it("returns zeros when getProjectRoot throws", async () => {
    vi.mocked(getProjectRoot).mockImplementation(() => {
      throw new Error("No project root");
    });
    const result = await warmSecretCache();
    expect(result).toEqual({ resolved: 0, failed: 0 });
  });

  it("resolves external secrets and caches them", async () => {
    vi.mocked(readdir).mockResolvedValue(["staging.json"] as any);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        variables: { base_url: "http://localhost" },
        secrets: {
          api_key: { type: "op", value: "op://vault/item/key" },
          plain: { type: "literal", value: "plain-val" },
        },
      })
    );

    const mockResolver = {
      type: "op",
      cliName: "op",
      installUrl: "https://example.com",
      checkAvailable: vi.fn().mockResolvedValue(true),
      resolve: vi.fn().mockResolvedValue("resolved-secret"),
      validate: vi.fn().mockReturnValue([]),
    };
    vi.mocked(getResolver).mockReturnValue(mockResolver);

    const result = await warmSecretCache();
    expect(result).toEqual({ resolved: 1, failed: 0 });

    // Verify cached
    const entry: SecretEntry = { type: "op", value: "op://vault/item/key" };
    expect(await getCachedSecret(entry)).toBe("resolved-secret");
  });

  it("skips secrets when CLI is not available", async () => {
    vi.mocked(readdir).mockResolvedValue(["staging.json"] as any);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        secrets: {
          api_key: { type: "op", value: "op://vault/item/key" },
        },
      })
    );

    const mockResolver = {
      type: "op",
      cliName: "op",
      installUrl: "https://example.com",
      checkAvailable: vi.fn().mockResolvedValue(false),
      resolve: vi.fn(),
      validate: vi.fn().mockReturnValue([]),
    };
    vi.mocked(getResolver).mockReturnValue(mockResolver);

    const result = await warmSecretCache();
    expect(result).toEqual({ resolved: 0, failed: 1 });
    expect(mockResolver.resolve).not.toHaveBeenCalled();
  });

  it("counts failed resolutions and continues", async () => {
    vi.mocked(readdir).mockResolvedValue(["staging.json"] as any);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        secrets: {
          key1: { type: "op", value: "op://vault/item/key1" },
          key2: { type: "op", value: "op://vault/item/key2" },
        },
      })
    );

    const mockResolver = {
      type: "op",
      cliName: "op",
      installUrl: "https://example.com",
      checkAvailable: vi.fn().mockResolvedValue(true),
      resolve: vi
        .fn()
        .mockResolvedValueOnce("value1")
        .mockRejectedValueOnce(new Error("not signed in")),
      validate: vi.fn().mockReturnValue([]),
    };
    vi.mocked(getResolver).mockReturnValue(mockResolver);

    const result = await warmSecretCache();
    expect(result).toEqual({ resolved: 1, failed: 1 });
  });

  it("deduplicates same secret across multiple environment files", async () => {
    vi.mocked(readdir).mockResolvedValue(["staging.json", "prod.json"] as any);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        secrets: {
          api_key: { type: "op", value: "op://vault/item/key" },
        },
      })
    );

    const mockResolver = {
      type: "op",
      cliName: "op",
      installUrl: "https://example.com",
      checkAvailable: vi.fn().mockResolvedValue(true),
      resolve: vi.fn().mockResolvedValue("resolved-secret"),
      validate: vi.fn().mockReturnValue([]),
    };
    vi.mocked(getResolver).mockReturnValue(mockResolver);

    const result = await warmSecretCache();
    expect(result).toEqual({ resolved: 1, failed: 0 });
    expect(mockResolver.resolve).toHaveBeenCalledTimes(1);
  });
});
