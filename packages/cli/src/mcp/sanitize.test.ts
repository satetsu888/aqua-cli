import { describe, it, expect } from "vitest";
import { unescapeUnicode } from "./sanitize.js";

describe("unescapeUnicode", () => {
  it("decodes basic katakana escape sequences", () => {
    expect(unescapeUnicode("\\u30ca\\u30d3")).toBe("ナビ");
  });

  it("decodes mixed ASCII and Unicode escapes", () => {
    expect(
      unescapeUnicode(
        "Web UI\\u30ca\\u30d3\\u30b2\\u30fc\\u30b7\\u30e7\\u30f3"
      )
    ).toBe("Web UIナビゲーション");
  });

  it("returns string without escapes unchanged", () => {
    expect(unescapeUnicode("hello world")).toBe("hello world");
    expect(unescapeUnicode("Web UIナビゲーション")).toBe("Web UIナビゲーション");
  });

  it("decodes ASCII escape sequences", () => {
    expect(unescapeUnicode("\\u0041\\u0042\\u0043")).toBe("ABC");
  });

  it("does not modify other escape sequences like \\n or \\t", () => {
    expect(unescapeUnicode("line1\\nline2")).toBe("line1\\nline2");
    expect(unescapeUnicode("col1\\tcol2")).toBe("col1\\tcol2");
  });

  it("handles empty string", () => {
    expect(unescapeUnicode("")).toBe("");
  });
});
