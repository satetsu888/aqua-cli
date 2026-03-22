import { describe, it, expect } from "vitest";
import { environmentFileSchema } from "./types.js";

describe("environmentFileSchema", () => {
  it("accepts valid file with variables and secrets", () => {
    const data = {
      variables: { api_base_url: "http://localhost" },
      secrets: {
        api_key: { type: "literal", value: "key123" },
        token: { type: "env", value: "MY_TOKEN" },
      },
    };
    const result = environmentFileSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("accepts variables only", () => {
    const result = environmentFileSchema.safeParse({
      variables: { a: "1" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts secrets only", () => {
    const result = environmentFileSchema.safeParse({
      secrets: { k: { type: "literal", value: "v" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = environmentFileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid secret type", () => {
    const data = {
      secrets: { k: { type: "unknown_type", value: "v" } },
    };
    const result = environmentFileSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects secret without value", () => {
    const data = {
      secrets: { k: { type: "literal" } },
    };
    const result = environmentFileSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  describe("aws_sm secrets", () => {
    it("accepts aws_sm with value only", () => {
      const result = environmentFileSchema.safeParse({
        secrets: { k: { type: "aws_sm", value: "my-secret" } },
      });
      expect(result.success).toBe(true);
    });

    it("accepts aws_sm with all optional fields", () => {
      const result = environmentFileSchema.safeParse({
        secrets: {
          k: {
            type: "aws_sm",
            value: "staging/db-credentials",
            region: "ap-northeast-1",
            json_key: "password",
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects aws_sm without value", () => {
      const result = environmentFileSchema.safeParse({
        secrets: { k: { type: "aws_sm" } },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("gcp_sm secrets", () => {
    it("accepts gcp_sm with value only", () => {
      const result = environmentFileSchema.safeParse({
        secrets: { k: { type: "gcp_sm", value: "my-secret" } },
      });
      expect(result.success).toBe(true);
    });

    it("accepts gcp_sm with all optional fields", () => {
      const result = environmentFileSchema.safeParse({
        secrets: {
          k: {
            type: "gcp_sm",
            value: "api-key",
            project: "my-project-123",
            version: "3",
            json_key: "key",
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects gcp_sm without value", () => {
      const result = environmentFileSchema.safeParse({
        secrets: { k: { type: "gcp_sm" } },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("hcv secrets", () => {
    it("accepts hcv with value only", () => {
      const result = environmentFileSchema.safeParse({
        secrets: { k: { type: "hcv", value: "myapp/staging/db" } },
      });
      expect(result.success).toBe(true);
    });

    it("accepts hcv with all optional fields", () => {
      const result = environmentFileSchema.safeParse({
        secrets: {
          k: {
            type: "hcv",
            value: "myapp/keys",
            field: "signing_key",
            mount: "kv",
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects hcv without value", () => {
      const result = environmentFileSchema.safeParse({
        secrets: { k: { type: "hcv" } },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("secret_providers", () => {
    it("accepts secret_providers with provider configs", () => {
      const result = environmentFileSchema.safeParse({
        secrets: { k: { type: "hcv", value: "myapp/db", field: "password" } },
        secret_providers: {
          hcv: { address: "https://vault.example.com:8200", namespace: "staging" },
          aws_sm: { region: "ap-northeast-1", profile: "staging" },
          gcp_sm: { project: "my-project-123" },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty secret_providers", () => {
      const result = environmentFileSchema.safeParse({
        secret_providers: {},
      });
      expect(result.success).toBe(true);
    });

    it("accepts environment file without secret_providers", () => {
      const result = environmentFileSchema.safeParse({
        secrets: { k: { type: "literal", value: "v" } },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("proxy", () => {
    it("accepts proxy with server only", () => {
      const result = environmentFileSchema.safeParse({
        proxy: { server: "http://proxy:3128" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts proxy with all fields", () => {
      const result = environmentFileSchema.safeParse({
        proxy: {
          server: "http://proxy:3128",
          bypass: "localhost,.internal.com",
          username: { type: "literal", value: "user" },
          password: { type: "env", value: "PROXY_PASS" },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts proxy with op-type credentials", () => {
      const result = environmentFileSchema.safeParse({
        proxy: {
          server: "socks5://proxy:1080",
          username: { type: "op", value: "op://vault/proxy/username" },
          password: { type: "op", value: "op://vault/proxy/password" },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects proxy without server", () => {
      const result = environmentFileSchema.safeParse({
        proxy: { bypass: "localhost" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects proxy with invalid credential type", () => {
      const result = environmentFileSchema.safeParse({
        proxy: {
          server: "http://proxy:3128",
          password: { type: "vault", value: "secret" },
        },
      });
      expect(result.success).toBe(false);
    });

    it("accepts variables, secrets, and proxy together", () => {
      const result = environmentFileSchema.safeParse({
        variables: { api_url: "http://localhost" },
        secrets: { key: { type: "literal", value: "v" } },
        proxy: { server: "http://proxy:3128" },
      });
      expect(result.success).toBe(true);
    });
  });
});
