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
      secrets: { k: { type: "vault", value: "v" } },
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
