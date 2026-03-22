export type MaskTargetKind =
  | "environment"
  | "http_request"
  | "http_response"
  | "dom_snapshot";

export interface MaskContext {
  /** Keys from the secrets section */
  secretKeys: Set<string>;
  /** Resolved secret values for value-based scanning */
  secretValues: Set<string>;
}

export interface MaskRule {
  name: string;
  /** Which data kinds this rule applies to */
  targets: MaskTargetKind[];
  /** Apply masking and return the masked data (non-destructive) */
  apply(kind: MaskTargetKind, data: unknown, ctx: MaskContext): unknown;
}

export const MASK_PLACEHOLDER = "***";
