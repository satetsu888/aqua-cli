import { describe, it, expect } from "vitest";
import {
  CookieExistsAssertionSchema,
  CookieValueAssertionSchema,
  LocalStorageExistsAssertionSchema,
  LocalStorageValueAssertionSchema,
  BrowserAssertionSchema,
  BrowserConfigSchema,
  BrowserStepSchema,
  AssertionSchema,
} from "./types.js";

describe("CookieExistsAssertionSchema", () => {
  it("parses valid cookie_exists assertion", () => {
    const result = CookieExistsAssertionSchema.parse({
      type: "cookie_exists",
      name: "session_id",
    });
    expect(result).toEqual({ type: "cookie_exists", name: "session_id" });
  });

  it("rejects missing name", () => {
    expect(() =>
      CookieExistsAssertionSchema.parse({ type: "cookie_exists" })
    ).toThrow();
  });
});

describe("CookieValueAssertionSchema", () => {
  it("parses valid cookie_value assertion with defaults", () => {
    const result = CookieValueAssertionSchema.parse({
      type: "cookie_value",
      name: "theme",
      expected: "dark",
    });
    expect(result).toEqual({
      type: "cookie_value",
      name: "theme",
      expected: "dark",
    });
  });

  it("parses with match option", () => {
    const result = CookieValueAssertionSchema.parse({
      type: "cookie_value",
      name: "session",
      expected: "abc",
      match: "contains",
    });
    expect(result.match).toBe("contains");
  });

  it("rejects invalid match option", () => {
    expect(() =>
      CookieValueAssertionSchema.parse({
        type: "cookie_value",
        name: "session",
        expected: "abc",
        match: "regex",
      })
    ).toThrow();
  });

  it("rejects missing expected", () => {
    expect(() =>
      CookieValueAssertionSchema.parse({
        type: "cookie_value",
        name: "session",
      })
    ).toThrow();
  });
});

describe("LocalStorageExistsAssertionSchema", () => {
  it("parses valid localstorage_exists assertion", () => {
    const result = LocalStorageExistsAssertionSchema.parse({
      type: "localstorage_exists",
      key: "auth_token",
    });
    expect(result).toEqual({ type: "localstorage_exists", key: "auth_token" });
  });

  it("rejects missing key", () => {
    expect(() =>
      LocalStorageExistsAssertionSchema.parse({ type: "localstorage_exists" })
    ).toThrow();
  });
});

describe("LocalStorageValueAssertionSchema", () => {
  it("parses valid localstorage_value assertion", () => {
    const result = LocalStorageValueAssertionSchema.parse({
      type: "localstorage_value",
      key: "lang",
      expected: "ja",
    });
    expect(result).toEqual({
      type: "localstorage_value",
      key: "lang",
      expected: "ja",
    });
  });

  it("parses with match option", () => {
    const result = LocalStorageValueAssertionSchema.parse({
      type: "localstorage_value",
      key: "prefs",
      expected: "dark",
      match: "contains",
    });
    expect(result.match).toBe("contains");
  });

  it("rejects invalid match option", () => {
    expect(() =>
      LocalStorageValueAssertionSchema.parse({
        type: "localstorage_value",
        key: "prefs",
        expected: "dark",
        match: "startsWith",
      })
    ).toThrow();
  });
});

describe("BrowserAssertionSchema discriminated union", () => {
  it("parses cookie_exists within browser assertion union", () => {
    const result = BrowserAssertionSchema.parse({
      type: "cookie_exists",
      name: "sid",
    });
    expect(result.type).toBe("cookie_exists");
  });

  it("parses cookie_value within browser assertion union", () => {
    const result = BrowserAssertionSchema.parse({
      type: "cookie_value",
      name: "theme",
      expected: "dark",
    });
    expect(result.type).toBe("cookie_value");
  });

  it("parses localstorage_exists within browser assertion union", () => {
    const result = BrowserAssertionSchema.parse({
      type: "localstorage_exists",
      key: "token",
    });
    expect(result.type).toBe("localstorage_exists");
  });

  it("parses localstorage_value within browser assertion union", () => {
    const result = BrowserAssertionSchema.parse({
      type: "localstorage_value",
      key: "lang",
      expected: "en",
      match: "exact",
    });
    expect(result.type).toBe("localstorage_value");
  });
});

describe("BrowserStepSchema - iframe actions", () => {
  it("parses switch_to_frame with CSS selector", () => {
    const result = BrowserStepSchema.parse({ switch_to_frame: "iframe#payment" });
    expect(result).toEqual({ switch_to_frame: "iframe#payment" });
  });

  it("parses switch_to_frame with attribute selector", () => {
    const result = BrowserStepSchema.parse({
      switch_to_frame: 'iframe[name="checkout"]',
    });
    expect(result).toEqual({ switch_to_frame: 'iframe[name="checkout"]' });
  });

  it("rejects switch_to_frame with non-string value", () => {
    expect(() => BrowserStepSchema.parse({ switch_to_frame: 123 })).toThrow();
  });

  it("parses switch_to_main_frame with true", () => {
    const result = BrowserStepSchema.parse({ switch_to_main_frame: true });
    expect(result).toEqual({ switch_to_main_frame: true });
  });

  it("rejects switch_to_main_frame with false", () => {
    expect(() =>
      BrowserStepSchema.parse({ switch_to_main_frame: false })
    ).toThrow();
  });

  it("rejects switch_to_main_frame with string", () => {
    expect(() =>
      BrowserStepSchema.parse({ switch_to_main_frame: "main" })
    ).toThrow();
  });
});

describe("BrowserConfigSchema", () => {
  it("parses config without timeout_ms", () => {
    const result = BrowserConfigSchema.parse({
      steps: [{ goto: "http://example.com" }],
    });
    expect(result.timeout_ms).toBeUndefined();
  });

  it("parses config with timeout_ms", () => {
    const result = BrowserConfigSchema.parse({
      steps: [{ goto: "http://example.com" }],
      timeout_ms: 5000,
    });
    expect(result.timeout_ms).toBe(5000);
  });

  it("rejects non-numeric timeout_ms", () => {
    expect(() =>
      BrowserConfigSchema.parse({
        steps: [{ goto: "http://example.com" }],
        timeout_ms: "fast",
      })
    ).toThrow();
  });

  it("parses config with iframe actions in steps", () => {
    const result = BrowserConfigSchema.parse({
      steps: [
        { goto: "http://example.com" },
        { switch_to_frame: "iframe#widget" },
        { click: ".btn" },
        { switch_to_main_frame: true },
        { click: ".other-btn" },
      ],
    });
    expect(result.steps).toHaveLength(5);
    expect(result.steps[1]).toEqual({ switch_to_frame: "iframe#widget" });
    expect(result.steps[3]).toEqual({ switch_to_main_frame: true });
  });
});

describe("AssertionSchema combined union", () => {
  it("parses cookie_exists in combined union", () => {
    const result = AssertionSchema.parse({
      type: "cookie_exists",
      name: "session",
    });
    expect(result.type).toBe("cookie_exists");
  });

  it("parses localstorage_value in combined union", () => {
    const result = AssertionSchema.parse({
      type: "localstorage_value",
      key: "prefs",
      expected: '{"theme":"dark"}',
      match: "contains",
    });
    expect(result.type).toBe("localstorage_value");
  });
});
