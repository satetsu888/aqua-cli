import { describe, it, expect } from "vitest";
import { generateTOTP } from "./totp.js";

describe("generateTOTP", () => {
  it("returns a 6-digit string", () => {
    // RFC 6238 test secret (Base32 of "12345678901234567890")
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const code = generateTOTP(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("returns consistent code for the same secret within a time window", () => {
    const secret = "JBSWY3DPEBLW64TMMQQQ";
    const code1 = generateTOTP(secret);
    const code2 = generateTOTP(secret);
    expect(code1).toBe(code2);
  });

  it("accepts an otpauth:// URI", () => {
    const uri =
      "otpauth://totp/Example:user@example.com?secret=JBSWY3DPEBLW64TMMQQQ&issuer=Example";
    const code = generateTOTP(uri);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("produces the same code from raw secret and equivalent otpauth:// URI", () => {
    const secret = "JBSWY3DPEBLW64TMMQQQ";
    const uri = `otpauth://totp/Test?secret=${secret}`;
    expect(generateTOTP(secret)).toBe(generateTOTP(uri));
  });
});
