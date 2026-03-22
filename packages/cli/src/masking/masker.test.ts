import { describe, it, expect } from "vitest";
import { Masker } from "./masker.js";
import { MASK_PLACEHOLDER } from "./types.js";

describe("Masker", () => {
  it("applies only rules matching the target kind", () => {
    const masker = new Masker({
      secretKeys: new Set(["api_key"]),
      secretValues: new Set(),
    });

    // environment kind → secretKeysRule applies
    const envResult = masker.mask("environment", {
      api_key: "secret",
      api_base_url: "http://localhost",
    }) as Record<string, string>;
    expect(envResult.api_key).toBe(MASK_PLACEHOLDER);
    expect(envResult.api_base_url).toBe("http://localhost");
  });

  it("chains multiple rules in pipeline", () => {
    const masker = new Masker({
      secretKeys: new Set(),
      secretValues: new Set(["mysecret"]),
    });

    // http_request kind → httpAuthHeaderRule + secretValueScanRule
    const data = {
      headers: { Authorization: "Bearer mysecret" },
      body: "data with mysecret inside",
    };
    const result = masker.mask("http_request", data) as Record<string, unknown>;
    expect(
      (result.headers as Record<string, unknown>).Authorization
    ).toBe(MASK_PLACEHOLDER);
    expect(result.body).toBe(`data with ${MASK_PLACEHOLDER} inside`);
  });

  it("returns data unchanged when no rules match", () => {
    const masker = new Masker({
      secretKeys: new Set(),
      secretValues: new Set(),
    });
    const data = { foo: "bar" };
    // environment kind with no secretKeys → secretKeysRule applies but no-ops
    const result = masker.mask("environment", data);
    expect(result).toEqual({ foo: "bar" });
  });
});
