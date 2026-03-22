import type { z } from "zod";
import type { Driver } from "../driver/types.js";

export type { Driver } from "../driver/types.js";
export type { Step, StepResult, AssertionResultData } from "../qa-plan/types.js";

/**
 * Plugin interface for extending aqua with custom action types.
 *
 * Plugins provide new step action types (beyond built-in http_request/browser)
 * with their own drivers, config schemas, and assertion types.
 */
export interface AquaPlugin {
  /** Plugin name (should match npm package name) */
  name: string;

  /** Action type name used in step.action */
  actionType: string;

  /** Zod schema for step config (used in MCP tool descriptions) */
  configSchema: z.ZodType;

  /** Zod schemas for plugin-specific assertion types (used in MCP tool descriptions) */
  assertionSchemas: z.ZodType[];

  /** Description text appended to MCP tool descriptions */
  actionDescription: string;

  /**
   * Create a Driver instance for executing steps.
   * @param variables - Resolved environment variables (includes secrets)
   */
  createDriver(variables: Record<string, string>): Promise<Driver>;
}
