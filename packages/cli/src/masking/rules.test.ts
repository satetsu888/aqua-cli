import { describe, it, expect } from "vitest";
import {
  secretKeysRule,
  httpAuthHeaderRule,
  httpSetCookieRule,
  domPasswordRule,
  secretValueScanRule,
} from "./rules.js";
import type { MaskContext } from "./types.js";
import { MASK_PLACEHOLDER } from "./types.js";

function ctx(
  secretKeys: string[] = [],
  secretValues: string[] = []
): MaskContext {
  return {
    secretKeys: new Set(secretKeys),
    secretValues: new Set(secretValues),
  };
}

describe("secretKeysRule", () => {
  it("masks keys present in secretKeys", () => {
    const data = { api_key: "secret123", api_base_url: "http://example.com" };
    const result = secretKeysRule.apply("environment", data, ctx(["api_key"]));
    expect(result).toEqual({
      api_key: MASK_PLACEHOLDER,
      api_base_url: "http://example.com",
    });
  });

  it("leaves all keys when secretKeys is empty", () => {
    const data = { a: "1", b: "2" };
    const result = secretKeysRule.apply("environment", data, ctx());
    expect(result).toEqual({ a: "1", b: "2" });
  });
});

describe("httpAuthHeaderRule", () => {
  it("masks Authorization header", () => {
    const data = {
      method: "GET",
      url: "http://example.com",
      headers: { Authorization: "Bearer token123", Accept: "application/json" },
    };
    const result = httpAuthHeaderRule.apply("http_request", data, ctx());
    expect((result as Record<string, unknown>).headers).toEqual({
      Authorization: MASK_PLACEHOLDER,
      Accept: "application/json",
    });
  });

  it("is case-insensitive", () => {
    const data = { headers: { authorization: "Basic abc" } };
    const result = httpAuthHeaderRule.apply(
      "http_request",
      data,
      ctx()
    ) as Record<string, unknown>;
    expect(
      (result.headers as Record<string, unknown>).authorization
    ).toBe(MASK_PLACEHOLDER);
  });

  it("returns data unchanged when no headers", () => {
    const data = { method: "GET", url: "http://example.com" };
    const result = httpAuthHeaderRule.apply("http_request", data, ctx());
    expect(result).toEqual(data);
  });
});

describe("httpSetCookieRule", () => {
  it("masks Set-Cookie header", () => {
    const data = {
      status: 200,
      headers: { "set-cookie": "session=abc; Path=/" },
    };
    const result = httpSetCookieRule.apply(
      "http_response",
      data,
      ctx()
    ) as Record<string, unknown>;
    expect(
      (result.headers as Record<string, unknown>)["set-cookie"]
    ).toBe(MASK_PLACEHOLDER);
  });

  it("returns data unchanged when no headers", () => {
    const data = { status: 200, body: "ok" };
    const result = httpSetCookieRule.apply("http_response", data, ctx());
    expect(result).toEqual(data);
  });
});

describe("domPasswordRule", () => {
  it("masks password input value", () => {
    const html = '<input type="password" value="secret123" name="pass">';
    const result = domPasswordRule.apply("dom_snapshot", html, ctx());
    expect(result).toContain(`value="${MASK_PLACEHOLDER}"`);
    expect(result).not.toContain("secret123");
  });

  it("returns non-string data unchanged", () => {
    const data = { foo: "bar" };
    const result = domPasswordRule.apply("dom_snapshot", data, ctx());
    expect(result).toEqual(data);
  });

  it("masks multiple password inputs", () => {
    const html =
      '<input type="password" value="a"><input type="password" value="b">';
    const result = domPasswordRule.apply("dom_snapshot", html, ctx()) as string;
    const matches = result.match(new RegExp(MASK_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"));
    expect(matches).toHaveLength(2);
  });
});

describe("secretValueScanRule", () => {
  it("replaces secret values in dom_snapshot strings", () => {
    const html = "<div>token: mysecretvalue</div>";
    const result = secretValueScanRule.apply(
      "dom_snapshot",
      html,
      ctx([], ["mysecretvalue"])
    );
    expect(result).toBe(`<div>token: ${MASK_PLACEHOLDER}</div>`);
  });

  it("deep-scans objects for http_request kind", () => {
    const data = {
      body: { nested: "contains mysecretvalue here" },
    };
    const result = secretValueScanRule.apply(
      "http_request",
      data,
      ctx([], ["mysecretvalue"])
    ) as Record<string, unknown>;
    expect(
      (result.body as Record<string, unknown>).nested
    ).toBe(`contains ${MASK_PLACEHOLDER} here`);
  });

  it("ignores secret values shorter than 4 characters", () => {
    const html = "<div>abc</div>";
    const result = secretValueScanRule.apply(
      "dom_snapshot",
      html,
      ctx([], ["abc"])
    );
    expect(result).toBe("<div>abc</div>");
  });

  it("returns data unchanged when secretValues is empty", () => {
    const data = { foo: "bar" };
    const result = secretValueScanRule.apply("http_request", data, ctx());
    expect(result).toEqual(data);
  });

});
