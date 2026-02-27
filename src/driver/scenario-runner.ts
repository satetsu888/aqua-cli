import type { Scenario, Step, StepResult, BrowserConfig } from "../qa-plan/types.js";
import { VIEWPORT_PRESETS } from "../qa-plan/types.js";
import type { ResolvedProxyConfig } from "../environment/index.js";
import type { StepCompleteEvent, OnStepCompleteCallback } from "./executor.js";
import { HttpDriver } from "./http.js";
import { BrowserDriver } from "./browser.js";
import { resolveStepOrder, checkStepDependencies, checkBrowserDependencies } from "./step-utils.js";
import { expandObject } from "../utils/template.js";
import { Masker } from "../masking/index.js";

export interface ScenarioRunResult {
  status: "passed" | "failed" | "error";
  totalSteps: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  results: StepResult[];
  resolvedVariables: Record<string, string>;
}

export class ScenarioRunner {
  private httpDriver: HttpDriver;
  private proxyConfig?: ResolvedProxyConfig;

  constructor(proxyConfig?: ResolvedProxyConfig) {
    this.proxyConfig = proxyConfig;
    this.httpDriver = new HttpDriver(proxyConfig);
  }

  async run(
    scenario: Scenario,
    variables: Record<string, string>,
    masker: Masker,
    onStepComplete?: OnStepCompleteCallback,
  ): Promise<ScenarioRunResult> {
    const results: StepResult[] = [];
    const completedSteps = new Map<string, StepResult>();
    const totalSteps = scenario.steps.length;
    let completedStepIndex = 0;

    const notifyStepComplete = (event: Omit<StepCompleteEvent, "index" | "totalSteps">) => {
      onStepComplete?.({
        ...event,
        index: completedStepIndex,
        totalSteps,
      });
      completedStepIndex++;
    };

    // Check if required variables are available
    if (scenario.requires && scenario.requires.length > 0) {
      const missing = scenario.requires.filter((v) => !(v in variables));
      if (missing.length > 0) {
        const errorMessage = `Missing required variable(s): ${missing.join(", ")}`;
        for (const step of scenario.steps) {
          const skippedResult: StepResult = {
            stepKey: step.step_key,
            scenarioName: scenario.name,
            action: step.action,
            status: "skipped",
            errorMessage,
            startedAt: new Date(),
            finishedAt: new Date(),
          };
          results.push(skippedResult);
          completedSteps.set(step.step_key, skippedResult);
          notifyStepComplete({
            scenarioName: scenario.name,
            stepKey: step.step_key,
            action: step.action,
            status: "skipped",
            errorMessage,
          });
        }
        return this.buildResult(results, variables, masker);
      }
    }

    // Check browser dependencies if needed
    const hasBrowserSteps = scenario.steps.some((s) => s.action === "browser");
    if (hasBrowserSteps) {
      await checkBrowserDependencies();
    }

    // Create browser driver for this scenario
    let browserDriver: BrowserDriver | null = null;
    if (hasBrowserSteps) {
      const firstBrowserStep = scenario.steps.find((s) => s.action === "browser");
      const viewportPreset = (firstBrowserStep?.config as BrowserConfig | undefined)?.viewport ?? "pc";
      const viewport = VIEWPORT_PRESETS[viewportPreset];
      browserDriver = new BrowserDriver(undefined, this.proxyConfig, viewport);
    }

    // Resolve execution order based on depends_on
    const ordered = resolveStepOrder(scenario.steps);

    try {
      for (const step of ordered) {
        // Check if dependencies are met
        const depsOk = checkStepDependencies(step, completedSteps);
        if (!depsOk) {
          const skippedResult: StepResult = {
            stepKey: step.step_key,
            scenarioName: scenario.name,
            action: step.action,
            status: "skipped",
            errorMessage: "Dependency not met",
            startedAt: new Date(),
            finishedAt: new Date(),
          };
          results.push(skippedResult);
          completedSteps.set(step.step_key, skippedResult);
          notifyStepComplete({
            scenarioName: scenario.name,
            stepKey: step.step_key,
            action: step.action,
            status: "skipped",
            errorMessage: "Dependency not met",
          });
          continue;
        }

        // Expand variables in step config
        const expandedStep = expandObject(step, variables);

        // Execute step
        let result: StepResult;
        switch (step.action) {
          case "http_request":
            result = await this.httpDriver.execute(expandedStep, variables);
            break;
          case "browser":
            result = await browserDriver!.execute(expandedStep, variables);
            break;
          default:
            result = {
              stepKey: step.step_key,
              scenarioName: scenario.name,
              action: step.action,
              status: "error",
              errorMessage: `Unknown action: ${step.action}`,
              startedAt: new Date(),
              finishedAt: new Date(),
            };
        }

        result.scenarioName = scenario.name;

        // Merge extracted values into shared variables
        if (result.extractedValues) {
          Object.assign(variables, result.extractedValues);
        }

        results.push(result);
        completedSteps.set(step.step_key, result);

        notifyStepComplete({
          scenarioName: scenario.name,
          stepKey: step.step_key,
          action: step.action,
          status: result.status,
          errorMessage: result.errorMessage,
        });

        // Abort remaining steps in this scenario on navigation failure
        if (result.abortScenario) {
          const currentIdx = ordered.indexOf(step);
          for (const remaining of ordered.slice(currentIdx + 1)) {
            const skippedResult: StepResult = {
              stepKey: remaining.step_key,
              scenarioName: scenario.name,
              action: remaining.action,
              status: "skipped",
              errorMessage: "Scenario aborted due to navigation failure",
              startedAt: new Date(),
              finishedAt: new Date(),
            };
            results.push(skippedResult);
            completedSteps.set(remaining.step_key, skippedResult);
            notifyStepComplete({
              scenarioName: scenario.name,
              stepKey: remaining.step_key,
              action: remaining.action,
              status: "skipped",
              errorMessage: "Scenario aborted due to navigation failure",
            });
          }
          break;
        }
      }
    } finally {
      if (browserDriver) {
        await browserDriver.close();
      }
    }

    return this.buildResult(results, variables, masker);
  }

  private buildResult(
    results: StepResult[],
    variables: Record<string, string>,
    masker: Masker,
  ): ScenarioRunResult {
    let hasFailure = false;
    let hasError = false;
    for (const r of results) {
      if (r.status === "failed") hasFailure = true;
      if (r.status === "error") hasError = true;
    }

    const status = hasError ? "error" : hasFailure ? "failed" : "passed";

    // Mask resolved variables for display
    const maskedVariables = masker.mask("environment", { ...variables }) as Record<string, string>;

    return {
      status,
      totalSteps: results.length,
      passed: results.filter((r) => r.status === "passed").length,
      failed: results.filter((r) => r.status === "failed").length,
      errors: results.filter((r) => r.status === "error").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
      resolvedVariables: maskedVariables,
    };
  }
}
