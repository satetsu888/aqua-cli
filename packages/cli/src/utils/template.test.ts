import { describe, it, expect, vi } from "vitest";
import { expandTemplate, expandObject, collectVariableReferences } from "./template.js";

vi.mock("./totp.js", () => ({
  generateTOTP: (secret: string) => {
    // Deterministic stub: return a fixed code per secret
    if (secret === "JBSWY3DPEBLW64TMMQQQ") return "123456";
    if (secret === "OTHERSECRETVALUE") return "654321";
    return "000000";
  },
}));

describe("expandTemplate", () => {
  it("expands a single variable", () => {
    expect(expandTemplate("hello {{name}}", { name: "world" })).toBe(
      "hello world"
    );
  });

  it("expands multiple variables", () => {
    expect(expandTemplate("{{a}}-{{b}}", { a: "X", b: "Y" })).toBe("X-Y");
  });

  it("expands the same variable appearing multiple times", () => {
    expect(expandTemplate("{{x}}-{{x}}", { x: "V" })).toBe("V-V");
  });

  it("leaves undefined variables as-is", () => {
    expect(expandTemplate("{{unknown}}", {})).toBe("{{unknown}}");
  });

  it("returns string unchanged when no placeholders", () => {
    expect(expandTemplate("no placeholders", { a: "1" })).toBe(
      "no placeholders"
    );
  });

  it("expands {{totp:key}} by computing a TOTP code from the secret", () => {
    const vars = { mfa_secret: "JBSWY3DPEBLW64TMMQQQ" };
    expect(expandTemplate("{{totp:mfa_secret}}", vars)).toBe("123456");
  });

  it("expands {{totp:key}} alongside normal variables", () => {
    const vars = {
      url: "https://example.com",
      otp_secret: "OTHERSECRETVALUE",
    };
    expect(expandTemplate("{{url}}/verify?code={{totp:otp_secret}}", vars)).toBe(
      "https://example.com/verify?code=654321"
    );
  });

  it("leaves {{totp:key}} as-is when the variable is not defined", () => {
    expect(expandTemplate("{{totp:missing}}", {})).toBe("{{totp:missing}}");
  });
});

describe("expandObject", () => {
  it("expands strings in nested objects", () => {
    const obj = { a: { b: "{{x}}" } };
    expect(expandObject(obj, { x: "val" })).toEqual({ a: { b: "val" } });
  });

  it("expands strings in arrays", () => {
    const arr = ["{{a}}", "literal", "{{b}}"];
    expect(expandObject(arr, { a: "1", b: "2" })).toEqual([
      "1",
      "literal",
      "2",
    ]);
  });

  it("passes through non-string primitives", () => {
    const obj = { num: 42, bool: true, nil: null };
    expect(expandObject(obj, { num: "X" })).toEqual({
      num: 42,
      bool: true,
      nil: null,
    });
  });
});

describe("collectVariableReferences", () => {
  it("collects a single variable from a string", () => {
    expect(collectVariableReferences("{{name}}")).toEqual(new Set(["name"]));
  });

  it("collects multiple variables from a string", () => {
    expect(collectVariableReferences("{{a}}-{{b}}")).toEqual(
      new Set(["a", "b"])
    );
  });

  it("deduplicates repeated references", () => {
    expect(collectVariableReferences("{{x}}-{{x}}")).toEqual(new Set(["x"]));
  });

  it("collects totp variable names (without totp: prefix)", () => {
    expect(collectVariableReferences("{{totp:mfa_secret}}")).toEqual(
      new Set(["mfa_secret"])
    );
  });

  it("collects both normal and totp variables", () => {
    expect(
      collectVariableReferences("{{url}}/verify?code={{totp:otp_secret}}")
    ).toEqual(new Set(["url", "otp_secret"]));
  });

  it("returns empty set for strings without placeholders", () => {
    expect(collectVariableReferences("no variables here")).toEqual(new Set());
  });

  it("collects from nested objects", () => {
    const obj = {
      config: {
        url: "{{api_base_url}}/path",
        headers: { Authorization: "Bearer {{api_key}}" },
      },
    };
    expect(collectVariableReferences(obj)).toEqual(
      new Set(["api_base_url", "api_key"])
    );
  });

  it("collects from arrays", () => {
    const arr = ["{{a}}", "literal", "{{b}}"];
    expect(collectVariableReferences(arr)).toEqual(new Set(["a", "b"]));
  });

  it("collects from a plan-like structure with scenarios and steps", () => {
    const planData = {
      name: "Test Plan",
      scenarios: [
        {
          name: "Scenario 1",
          steps: [
            {
              action: "http_request",
              config: {
                method: "GET",
                url: "{{api_base_url}}/users",
                headers: { "X-API-Key": "{{api_key}}" },
              },
            },
            {
              action: "browser",
              config: {
                steps: [
                  { action: "goto", url: "{{web_base_url}}/login" },
                  { action: "type", selector: "#password", text: "{{password}}" },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(collectVariableReferences(planData)).toEqual(
      new Set(["api_base_url", "api_key", "web_base_url", "password"])
    );
  });

  it("handles non-string primitives without error", () => {
    expect(collectVariableReferences({ num: 42, bool: true, nil: null })).toEqual(
      new Set()
    );
  });

  it("returns empty set for null/undefined input", () => {
    expect(collectVariableReferences(null)).toEqual(new Set());
    expect(collectVariableReferences(undefined)).toEqual(new Set());
  });
});
