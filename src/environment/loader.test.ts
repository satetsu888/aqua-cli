import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveEnvironment } from "./loader.js";
import type { EnvironmentFile } from "./types.js";

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
  });
});
