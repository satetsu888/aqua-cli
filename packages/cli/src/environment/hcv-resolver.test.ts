import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hcvResolver } from "./hcv-resolver.js";
import type { SecretEntry } from "./types.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

function mockExecFile(stdout: string) {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
      cb(null, { stdout });
    },
  );
}

function mockExecFileError(message: string) {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], cb: (err: Error) => void) => {
      cb(new Error(message));
    },
  );
}

describe("hcvResolver", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("has correct metadata", () => {
    expect(hcvResolver.type).toBe("hcv");
    expect(hcvResolver.cliName).toContain("Vault");
    expect(hcvResolver.installUrl).toContain("hashicorp.com");
  });

  describe("checkAvailable", () => {
    it("returns true when vault cli is available", async () => {
      mockExecFile("Vault v1.15.0");
      expect(await hcvResolver.checkAvailable()).toBe(true);
    });

    it("returns false when vault cli is not available", async () => {
      mockExecFileError("command not found: vault");
      expect(await hcvResolver.checkAvailable()).toBe(false);
    });
  });

  describe("resolve", () => {
    it("resolves a specific field", async () => {
      mockExecFile("my-field-value\n");
      const entry: SecretEntry = {
        type: "hcv",
        value: "myapp/staging/db",
        field: "password",
      };
      const result = await hcvResolver.resolve(entry, "test");
      expect(result).toBe("my-field-value");

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe("vault");
      expect(call[1]).toContain("-mount=secret"); // default mount
      expect(call[1]).toContain("-field=password");
      expect(call[1]).toContain("myapp/staging/db");
    });

    it("uses custom mount point", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = {
        type: "hcv",
        value: "myapp/keys",
        field: "key",
        mount: "kv",
      };
      await hcvResolver.resolve(entry, "test");

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("-mount=kv");
    });

    it("resolves full secret as JSON when no field specified (KV v2)", async () => {
      const kvV2Response = JSON.stringify({
        data: {
          data: { username: "admin", password: "secret" },
          metadata: { version: 1 },
        },
      });
      mockExecFile(kvV2Response + "\n");
      const entry: SecretEntry = { type: "hcv", value: "myapp/db" };
      const result = await hcvResolver.resolve(entry, "test");
      expect(JSON.parse(result)).toEqual({ username: "admin", password: "secret" });

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("-format=json");
      expect(call[1]).not.toContain("-field=");
    });

    it("throws auth error with guidance", async () => {
      mockExecFileError("permission denied");
      const entry: SecretEntry = {
        type: "hcv",
        value: "myapp/secret",
        field: "key",
      };
      await expect(hcvResolver.resolve(entry, "test")).rejects.toThrow(
        "vault login"
      );
    });

    it("throws missing client token error with guidance", async () => {
      mockExecFileError("missing client token");
      const entry: SecretEntry = {
        type: "hcv",
        value: "myapp/secret",
        field: "key",
      };
      await expect(hcvResolver.resolve(entry, "test")).rejects.toThrow(
        "VAULT_TOKEN"
      );
    });

    it("throws not-found error", async () => {
      mockExecFileError("no secrets at path");
      const entry: SecretEntry = {
        type: "hcv",
        value: "missing/path",
        field: "key",
      };
      await expect(hcvResolver.resolve(entry, "test")).rejects.toThrow(
        "secret not found: secret/missing/path"
      );
    });

    it("passes address from providerConfig as CLI flag", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = {
        type: "hcv",
        value: "myapp/secret",
        field: "key",
      };
      await hcvResolver.resolve(entry, "test", {
        address: "https://vault.example.com:8200",
      });

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("-address=https://vault.example.com:8200");
    });

    it("passes namespace from providerConfig as CLI flag", async () => {
      mockExecFile("value\n");
      const entry: SecretEntry = {
        type: "hcv",
        value: "myapp/secret",
        field: "key",
      };
      await hcvResolver.resolve(entry, "test", {
        address: "https://vault.example.com:8200",
        namespace: "staging",
      });

      const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain("-namespace=staging");
    });
  });

  describe("validate", () => {
    it("returns warning when neither providerConfig.address nor VAULT_ADDR is set", () => {
      delete process.env.VAULT_ADDR;
      const entry: SecretEntry = { type: "hcv", value: "myapp/secret" };
      const issues = hcvResolver.validate(entry);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("warning");
      expect(issues[0].message).toContain("secret_providers.hcv");
    });

    it("returns no issues when VAULT_ADDR env var is set", () => {
      process.env.VAULT_ADDR = "http://vault:8200";
      const entry: SecretEntry = { type: "hcv", value: "myapp/secret" };
      const issues = hcvResolver.validate(entry);
      expect(issues).toEqual([]);
    });

    it("returns no issues when providerConfig.address is set", () => {
      delete process.env.VAULT_ADDR;
      const entry: SecretEntry = { type: "hcv", value: "myapp/secret" };
      const issues = hcvResolver.validate(entry, {
        address: "https://vault.example.com:8200",
      });
      expect(issues).toEqual([]);
    });
  });
});
