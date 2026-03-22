import * as OTPAuth from "otpauth";

/**
 * Generate a TOTP code from a Base32-encoded secret or an otpauth:// URI.
 *
 * Accepts:
 * - Raw Base32 secret (e.g. "JBSWY3DPEBLW64TMMQQQ")
 * - otpauth:// URI (e.g. "otpauth://totp/Example:user@example.com?secret=JBSWY3DP...")
 *
 * For raw Base32 secrets, defaults to: 6 digits, SHA1, 30-second period.
 * For otpauth:// URIs, parameters are extracted from the URI.
 */
export function generateTOTP(secret: string): string {
  if (secret.startsWith("otpauth://")) {
    const parsed = OTPAuth.URI.parse(secret);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error(
        `Expected a TOTP URI but got: ${secret.slice(0, 30)}...`
      );
    }
    return parsed.generate();
  }

  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: 6,
    algorithm: "SHA1",
    period: 30,
  });
  return totp.generate();
}
