import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveEnvironment } from "./loader.js";
import { registerResolver, getResolver } from "./resolver-registry.js";
import type { ExternalSecretResolver } from "./resolver-registry.js";
import type { EnvironmentFile } from "./types.js";
import { readFileSync } from "node:fs";
import { setCachedSecret, clearSecretCache } from "./secret-cache.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

describe("resolveEnvironment", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves literal secrets", async () => {
    const envFile: EnvironmentFile = {
      variables: { api_base_url: "http://localhost" },
      secrets: {
        api_key: { type: "literal", value: "secret123" },
      },
    };
    const result = await resolveEnvironment(envFile);
    expect(result.variables.api_base_url).toBe("http://localhost");
    expect(result.variables.api_key).toBe("secret123");
    expect(result.secretKeys.has("api_key")).toBe(true);
    expect(result.secretValues.has("secret123")).toBe(true);
  });

  it("resolves env-type secrets from process.env", async () => {
    process.env.MY_TOKEN = "token-value";
    const envFile: EnvironmentFile = {
      secrets: {
        token: { type: "env", value: "MY_TOKEN" },
      },
    };
    const result = await resolveEnvironment(envFile);
    expect(result.variables.token).toBe("token-value");
    expect(result.secretValues.has("token-value")).toBe(true);
  });

  it("throws when env variable is not set", async () => {
    delete process.env.MISSING_VAR;
    const envFile: EnvironmentFile = {
      secrets: {
        s: { type: "env", value: "MISSING_VAR" },
      },
    };
    await expect(resolveEnvironment(envFile)).rejects.toThrow(
      'Environment variable "MISSING_VAR" is not set'
    );
  });

  it("handles empty environment file", async () => {
    const result = await resolveEnvironment({});
    expect(result.variables).toEqual({});
    expect(result.secretKeys.size).toBe(0);
    expect(result.secretValues.size).toBe(0);
    expect(result.proxy).toBeUndefined();
  });

  describe("requiredKeys filtering", () => {
    it("resolves only secrets whose keys are in requiredKeys", async () => {
      process.env.USED_TOKEN = "used-value";
      process.env.UNUSED_TOKEN = "unused-value";
      const envFile: EnvironmentFile = {
        variables: { url: "http://localhost" },
        secrets: {
          used_secret: { type: "env", value: "USED_TOKEN" },
          unused_secret: { type: "env", value: "UNUSED_TOKEN" },
        },
      };
      const result = await resolveEnvironment(envFile, new Set(["used_secret"]));
      expect(result.variables.used_secret).toBe("used-value");
      expect(result.variables.unused_secret).toBeUndefined();
      expect(result.secretKeys.has("used_secret")).toBe(true);
      expect(result.secretKeys.has("unused_secret")).toBe(false);
      expect(result.secretValues.has("used-value")).toBe(true);
      expect(result.secretValues.has("unused-value")).toBe(false);
    });

    it("resolves all secrets when requiredKeys is undefined", async () => {
      const envFile: EnvironmentFile = {
        secrets: {
          a: { type: "literal", value: "val-a" },
          b: { type: "literal", value: "val-b" },
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.variables.a).toBe("val-a");
      expect(result.variables.b).toBe("val-b");
    });

    it("always includes non-secret variables regardless of requiredKeys", async () => {
      const envFile: EnvironmentFile = {
        variables: { url: "http://localhost", timeout: "30" },
        secrets: {
          api_key: { type: "literal", value: "secret" },
        },
      };
      const result = await resolveEnvironment(envFile, new Set());
      expect(result.variables.url).toBe("http://localhost");
      expect(result.variables.timeout).toBe("30");
      expect(result.variables.api_key).toBeUndefined();
    });

    it("does not throw for missing env when secret is filtered out", async () => {
      delete process.env.MISSING_VAR;
      const envFile: EnvironmentFile = {
        secrets: {
          needed: { type: "literal", value: "ok" },
          unneeded: { type: "env", value: "MISSING_VAR" },
        },
      };
      const result = await resolveEnvironment(envFile, new Set(["needed"]));
      expect(result.variables.needed).toBe("ok");
      expect(result.variables.unneeded).toBeUndefined();
    });
  });

  describe("external resolver integration", () => {
    // Register a mock resolver for testing the registry-based dispatch
    const mockResolve = vi.fn();
    const mockCheckAvailable = vi.fn();

    beforeEach(() => {
      mockResolve.mockReset();
      mockCheckAvailable.mockReset();
      mockCheckAvailable.mockResolvedValue(true);

      // Register mock resolvers that simulate aws_sm and hcv
      // overriding the real ones for test purposes
      const mockAwsResolver: ExternalSecretResolver = {
        type: "aws_sm",
        cliName: "Mock AWS CLI",
        installUrl: "https://example.com",
        checkAvailable: mockCheckAvailable,
        resolve: mockResolve,
        validate: () => [],
      };
      registerResolver(mockAwsResolver);
    });

    it("delegates to registered resolver for external types", async () => {
      mockResolve.mockResolvedValue("resolved-aws-value");
      const envFile: EnvironmentFile = {
        secrets: {
          db_pass: { type: "aws_sm", value: "staging/db", json_key: "password" },
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.variables.db_pass).toBe("resolved-aws-value");
      expect(result.secretKeys.has("db_pass")).toBe(true);
      expect(result.secretValues.has("resolved-aws-value")).toBe(true);
      expect(mockResolve).toHaveBeenCalledOnce();
    });

    it("checks CLI availability before resolving", async () => {
      mockCheckAvailable.mockResolvedValue(false);
      const envFile: EnvironmentFile = {
        secrets: {
          s: { type: "aws_sm", value: "my-secret" },
        },
      };
      await expect(resolveEnvironment(envFile)).rejects.toThrow(
        "Mock AWS CLI is not installed"
      );
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("skips CLI check for filtered-out external secrets", async () => {
      mockCheckAvailable.mockResolvedValue(false);
      const envFile: EnvironmentFile = {
        secrets: {
          needed: { type: "literal", value: "ok" },
          aws_secret: { type: "aws_sm", value: "not-needed" },
        },
      };
      // aws_secret is filtered out, so CLI check should not fail
      const result = await resolveEnvironment(envFile, new Set(["needed"]));
      expect(result.variables.needed).toBe("ok");
      expect(result.variables.aws_secret).toBeUndefined();
    });

    it("throws for unknown secret type", async () => {
      // Manually construct an entry with unknown type to test the fallback
      // This bypasses Zod validation since we call resolveEnvironment directly
      const envFile = {
        secrets: {
          s: { type: "unknown_type", value: "v" },
        },
      } as unknown as EnvironmentFile;
      await expect(resolveEnvironment(envFile)).rejects.toThrow(
        'Unknown secret type: "unknown_type"'
      );
    });

    it("passes secret_providers config to resolver", async () => {
      mockResolve.mockResolvedValue("resolved-value");
      const envFile: EnvironmentFile = {
        secrets: {
          s: { type: "aws_sm", value: "my-secret" },
        },
        secret_providers: {
          aws_sm: { region: "eu-west-1", profile: "staging" },
        },
      };
      await resolveEnvironment(envFile);
      expect(mockResolve).toHaveBeenCalledWith(
        expect.objectContaining({ type: "aws_sm", value: "my-secret" }),
        expect.any(String),
        { region: "eu-west-1", profile: "staging" },
      );
    });

    it("uses cached value instead of calling resolver", async () => {
      const entry = { type: "aws_sm" as const, value: "cached-secret" };
      setCachedSecret(entry, undefined, "cached-resolved-value");

      const envFile: EnvironmentFile = {
        secrets: {
          s: entry,
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.variables.s).toBe("cached-resolved-value");
      expect(mockResolve).not.toHaveBeenCalled();

      clearSecretCache();
    });

    it("caches resolved value after calling resolver", async () => {
      clearSecretCache();
      mockResolve.mockResolvedValue("freshly-resolved");
      const envFile: EnvironmentFile = {
        secrets: {
          s: { type: "aws_sm", value: "new-secret" },
        },
      };
      await resolveEnvironment(envFile);

      // Second call should use cache
      mockResolve.mockReset();
      mockCheckAvailable.mockResolvedValue(true);
      const result2 = await resolveEnvironment(envFile);
      expect(result2.variables.s).toBe("freshly-resolved");
      expect(mockResolve).not.toHaveBeenCalled();

      clearSecretCache();
    });

    it("passes undefined providerConfig when secret_providers is not set", async () => {
      mockResolve.mockResolvedValue("resolved-value");
      const envFile: EnvironmentFile = {
        secrets: {
          s: { type: "aws_sm", value: "my-secret" },
        },
      };
      await resolveEnvironment(envFile);
      expect(mockResolve).toHaveBeenCalledWith(
        expect.objectContaining({ type: "aws_sm" }),
        expect.any(String),
        undefined,
      );
    });
  });

  describe("proxy resolution", () => {
    it("resolves proxy with server only", async () => {
      const envFile: EnvironmentFile = {
        proxy: { server: "http://proxy:3128" },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.proxy).toEqual({
        server: "http://proxy:3128",
        bypass: undefined,
      });
    });

    it("resolves proxy with bypass", async () => {
      const envFile: EnvironmentFile = {
        proxy: {
          server: "http://proxy:3128",
          bypass: "localhost,.internal.com",
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.proxy?.server).toBe("http://proxy:3128");
      expect(result.proxy?.bypass).toBe("localhost,.internal.com");
    });

    it("resolves proxy with literal credentials", async () => {
      const envFile: EnvironmentFile = {
        proxy: {
          server: "http://proxy:3128",
          username: { type: "literal", value: "proxyuser" },
          password: { type: "literal", value: "proxypass" },
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.proxy?.username).toBe("proxyuser");
      expect(result.proxy?.password).toBe("proxypass");
    });

    it("resolves proxy password from env variable", async () => {
      process.env.PROXY_PASSWORD = "secret-proxy-pass";
      const envFile: EnvironmentFile = {
        proxy: {
          server: "http://proxy:3128",
          username: { type: "literal", value: "user" },
          password: { type: "env", value: "PROXY_PASSWORD" },
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.proxy?.password).toBe("secret-proxy-pass");
    });

    it("adds proxy password to secretValues for masking", async () => {
      const envFile: EnvironmentFile = {
        proxy: {
          server: "http://proxy:3128",
          password: { type: "literal", value: "proxy-secret" },
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.secretValues.has("proxy-secret")).toBe(true);
    });

    it("throws when proxy password env variable is not set", async () => {
      delete process.env.MISSING_PROXY_PASS;
      const envFile: EnvironmentFile = {
        proxy: {
          server: "http://proxy:3128",
          password: { type: "env", value: "MISSING_PROXY_PASS" },
        },
      };
      await expect(resolveEnvironment(envFile)).rejects.toThrow(
        'Environment variable "MISSING_PROXY_PASS" is not set'
      );
    });

    it("returns undefined proxy when not configured", async () => {
      const envFile: EnvironmentFile = {
        variables: { url: "http://localhost" },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.proxy).toBeUndefined();
    });

    it("reads ca_cert_path into caCert buffer", async () => {
      const certData = Buffer.from("-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----");
      vi.mocked(readFileSync).mockReturnValue(certData);
      const envFile: EnvironmentFile = {
        proxy: {
          server: "http://proxy:3128",
          ca_cert_path: "/path/to/target-ca.pem",
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(readFileSync).toHaveBeenCalledWith("/path/to/target-ca.pem");
      expect(result.proxy?.caCert).toEqual(certData);
    });

    it("reads proxy_ca_cert_path into proxyCaCert buffer", async () => {
      const certData = Buffer.from("-----BEGIN CERTIFICATE-----\nproxy\n-----END CERTIFICATE-----");
      vi.mocked(readFileSync).mockReturnValue(certData);
      const envFile: EnvironmentFile = {
        proxy: {
          server: "https://proxy:3128",
          proxy_ca_cert_path: "/path/to/proxy-ca.pem",
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(readFileSync).toHaveBeenCalledWith("/path/to/proxy-ca.pem");
      expect(result.proxy?.proxyCaCert).toEqual(certData);
    });

    it("passes through reject_unauthorized", async () => {
      const envFile: EnvironmentFile = {
        proxy: {
          server: "http://proxy:3128",
          reject_unauthorized: false,
        },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.proxy?.rejectUnauthorized).toBe(false);
    });

    it("does not set TLS fields when not configured", async () => {
      const envFile: EnvironmentFile = {
        proxy: { server: "http://proxy:3128" },
      };
      const result = await resolveEnvironment(envFile);
      expect(result.proxy?.caCert).toBeUndefined();
      expect(result.proxy?.proxyCaCert).toBeUndefined();
      expect(result.proxy?.rejectUnauthorized).toBeUndefined();
    });
  });
});
