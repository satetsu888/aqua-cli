import { describe, it, expect, afterEach } from "vitest";
import { expandEnvVars, expandEnvVarsInRecord, extractEnvVarReferences } from "./env-expand.js";

describe("expandEnvVars", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("expands {$VAR} with env value", () => {
    process.env.MY_HOST = "api.example.com";
    expect(expandEnvVars("http://{$MY_HOST}/v1")).toBe("http://api.example.com/v1");
  });

  it("expands {$VAR:-default} with env value when set", () => {
    process.env.SUBDOMAIN = "staging";
    expect(expandEnvVars("http://{$SUBDOMAIN:-default}.example.com")).toBe(
      "http://staging.example.com"
    );
  });

  it("uses default value when env var is not set", () => {
    delete process.env.SUBDOMAIN;
    expect(expandEnvVars("http://{$SUBDOMAIN:-default}.example.com")).toBe(
      "http://default.example.com"
    );
  });

  it("uses empty string as default with {$VAR:-}", () => {
    delete process.env.OPTIONAL;
    expect(expandEnvVars("prefix{$OPTIONAL:-}suffix")).toBe("prefixsuffix");
  });

  it("throws when env var is not set and no default", () => {
    delete process.env.REQUIRED_VAR;
    expect(() => expandEnvVars("{$REQUIRED_VAR}")).toThrow(
      'Environment variable "REQUIRED_VAR" is not set and has no default value'
    );
  });

  it("includes context in error message", () => {
    delete process.env.MISSING;
    expect(() => expandEnvVars("{$MISSING}", 'variable "api_url"')).toThrow(
      '(in variable "api_url")'
    );
  });

  it("expands multiple patterns in one string", () => {
    process.env.PROTO = "https";
    process.env.HOST = "api.test.com";
    delete process.env.PORT;
    expect(expandEnvVars("{$PROTO}://{$HOST}:{$PORT:-8080}/api")).toBe(
      "https://api.test.com:8080/api"
    );
  });

  it("returns string unchanged when no patterns present", () => {
    expect(expandEnvVars("http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("does not expand {{variable}} template syntax", () => {
    expect(expandEnvVars("{{api_base_url}}/users")).toBe("{{api_base_url}}/users");
  });

  it("handles env var with underscore-heavy name", () => {
    process.env.__MY_VAR_2 = "val";
    expect(expandEnvVars("{$__MY_VAR_2}")).toBe("val");
  });
});

describe("expandEnvVarsInRecord", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("expands all values in the record", () => {
    process.env.HOST = "staging.example.com";
    delete process.env.PORT;
    const result = expandEnvVarsInRecord({
      api_url: "http://{$HOST}:{$PORT:-9080}/api",
      plain: "no-expansion-needed",
    });
    expect(result).toEqual({
      api_url: "http://staging.example.com:9080/api",
      plain: "no-expansion-needed",
    });
  });

  it("includes key name in error context", () => {
    delete process.env.MISSING;
    expect(() =>
      expandEnvVarsInRecord({ my_key: "{$MISSING}" }, "variable")
    ).toThrow('(in variable "my_key")');
  });
});

describe("extractEnvVarReferences", () => {
  it("extracts required reference", () => {
    const refs = extractEnvVarReferences("{$HOST}");
    expect(refs).toEqual([{ name: "HOST", hasDefault: false }]);
  });

  it("extracts reference with default", () => {
    const refs = extractEnvVarReferences("{$PORT:-8080}");
    expect(refs).toEqual([{ name: "PORT", hasDefault: true }]);
  });

  it("extracts multiple references", () => {
    const refs = extractEnvVarReferences("{$PROTO}://{$HOST:-localhost}:{$PORT:-8080}");
    expect(refs).toEqual([
      { name: "PROTO", hasDefault: false },
      { name: "HOST", hasDefault: true },
      { name: "PORT", hasDefault: true },
    ]);
  });

  it("returns empty array for string without patterns", () => {
    expect(extractEnvVarReferences("http://localhost")).toEqual([]);
  });

  it("detects empty default as hasDefault=true", () => {
    const refs = extractEnvVarReferences("{$VAR:-}");
    expect(refs).toEqual([{ name: "VAR", hasDefault: true }]);
  });
});
