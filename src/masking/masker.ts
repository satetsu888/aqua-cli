import type { MaskContext, MaskTargetKind } from "./types.js";
import {
  secretKeysRule,
  httpAuthHeaderRule,
  httpSetCookieRule,
  domPasswordRule,
  secretValueScanRule,
} from "./rules.js";
import type { MaskRule } from "./types.js";

export class Masker {
  private rules: MaskRule[];
  private ctx: MaskContext;

  constructor(ctx: MaskContext) {
    this.ctx = ctx;
    this.rules = [
      secretKeysRule,
      httpAuthHeaderRule,
      httpSetCookieRule,
      domPasswordRule,
      secretValueScanRule,
    ];
  }

  /**
   * Apply all applicable masking rules to the given data.
   * Returns a new masked copy — does not mutate the input.
   */
  mask(kind: MaskTargetKind, data: unknown): unknown {
    return this.rules
      .filter((r) => r.targets.includes(kind))
      .reduce((d, rule) => rule.apply(kind, d, this.ctx), data);
  }
}
