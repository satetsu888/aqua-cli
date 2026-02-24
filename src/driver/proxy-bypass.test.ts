import { describe, it, expect } from "vitest";
import { parseBypassPatterns, shouldBypassProxy } from "./proxy-bypass.js";

describe("parseBypassPatterns", () => {
  it("parses comma-separated patterns", () => {
    expect(parseBypassPatterns("localhost,.internal.com")).toEqual([
      "localhost",
      ".internal.com",
    ]);
  });

  it("trims whitespace", () => {
    expect(parseBypassPatterns(" localhost , .foo.com ")).toEqual([
      "localhost",
      ".foo.com",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseBypassPatterns("")).toEqual([]);
  });

  it("lowercases patterns", () => {
    expect(parseBypassPatterns("LOCALHOST,.Internal.COM")).toEqual([
      "localhost",
      ".internal.com",
    ]);
  });
});

describe("shouldBypassProxy", () => {
  it("returns false when patterns list is empty", () => {
    expect(shouldBypassProxy("http://localhost/path", [])).toBe(false);
  });

  it("matches exact hostname", () => {
    const patterns = ["localhost"];
    expect(shouldBypassProxy("http://localhost/path", patterns)).toBe(true);
    expect(shouldBypassProxy("http://localhost:8080/path", patterns)).toBe(true);
  });

  it("does not match partial hostname", () => {
    expect(
      shouldBypassProxy("http://localhost.localdomain/path", ["localhost"]),
    ).toBe(false);
  });

  it("matches suffix with leading dot", () => {
    const patterns = [".internal.com"];
    expect(shouldBypassProxy("http://api.internal.com/path", patterns)).toBe(
      true,
    );
    expect(
      shouldBypassProxy("http://deep.api.internal.com/path", patterns),
    ).toBe(true);
  });

  it("leading dot does not match the bare domain itself", () => {
    expect(
      shouldBypassProxy("http://internal.com/path", [".internal.com"]),
    ).toBe(false);
  });

  it("wildcard matches everything", () => {
    expect(shouldBypassProxy("http://anything.com/path", ["*"])).toBe(true);
  });

  it("is case insensitive", () => {
    expect(shouldBypassProxy("http://LOCALHOST/path", ["localhost"])).toBe(true);
  });

  it("matches host:port when pattern includes port", () => {
    const patterns = ["localhost:3000"];
    expect(shouldBypassProxy("http://localhost:3000/path", patterns)).toBe(true);
    expect(shouldBypassProxy("http://localhost:8080/path", patterns)).toBe(
      false,
    );
  });

  it("returns false for invalid URL", () => {
    expect(shouldBypassProxy("not-a-url", ["localhost"])).toBe(false);
  });

  it("returns false when no patterns match", () => {
    expect(
      shouldBypassProxy("http://example.com/path", [
        "localhost",
        ".internal.com",
      ]),
    ).toBe(false);
  });
});
