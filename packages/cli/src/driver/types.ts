import type { Step, StepResult } from "../qa-plan/types.js";

export interface Driver {
  execute(
    step: Step,
    variables: Record<string, string>
  ): Promise<StepResult>;
}
