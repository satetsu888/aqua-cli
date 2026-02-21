import type { QAPlanData, Scenario, Step, StepResult } from "../qa-plan/types.js";
import type { AquaClient, EnvironmentLayer, ProxyConfig } from "../api/client.js";
import type { ResolvedEnvironment, ResolvedProxyConfig } from "../environment/index.js";
import { HttpDriver } from "./http.js";
import { BrowserDriver, type BrowserStorageState } from "./browser.js";
import { resolveStepOrder, checkStepDependencies, checkBrowserDependencies } from "./step-utils.js";
import { expandObject } from "../utils/template.js";
import { Masker } from "../masking/index.js";
import type { MaskContext } from "../masking/index.js";

export interface ExecutionSummary {
  executionId: string;
  executionUrl: string;
  status: "completed" | "failed" | "error";
  totalSteps: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  results: StepResult[];
  resolvedVariables: Record<string, string>;
  recorded: boolean;
}

export interface StepCompleteEvent {
  scenarioName: string;
  stepKey: string;
  action: string;
  status: string;
  errorMessage?: string;
  index: number;
  totalSteps: number;
}

export type OnStepCompleteCallback = (event: StepCompleteEvent) => void | Promise<void>;

export class QAPlanExecutor {
  private client: AquaClient;

  constructor(client: AquaClient) {
    this.client = client;
  }

  async execute(
    plan: QAPlanData,
    planVersionId: string,
    envOverrides?: Record<string, string>,
    resolvedEnv?: ResolvedEnvironment,
    envName?: string,
    onExecutionCreated?: (executionId: string, executionUrl: string) => void,
    onStepComplete?: OnStepCompleteCallback,
    skipRecording?: boolean,
  ): Promise<ExecutionSummary> {
    const recording = !skipRecording;

    // Check browser dependencies before creating execution record
    const hasBrowserSteps = plan.scenarios.some((s) =>
      s.steps.some((step) => step.action === "browser")
    );
    if (hasBrowserSteps) {
      await checkBrowserDependencies();
    }

    // Create drivers with proxy config from environment
    const proxyConfig = resolvedEnv?.proxy;
    const httpDriver = new HttpDriver(proxyConfig);

    // Build environment layers
    const layers: EnvironmentLayer[] = [];
    if (plan.variables && Object.keys(plan.variables).length > 0) {
      layers.push({ type: "qa_plan", variables: plan.variables });
    }
    if (resolvedEnv && Object.keys(resolvedEnv.variables).length > 0) {
      layers.push({ type: "environment", name: envName!, variables: resolvedEnv.variables });
    }
    if (envOverrides && Object.keys(envOverrides).length > 0) {
      layers.push({ type: "override", variables: envOverrides });
    }

    // Compute resolved variables for template expansion
    const variables: Record<string, string> = {};
    for (const layer of layers) {
      Object.assign(variables, layer.variables);
    }

    // Build mask context from environment file secrets
    const maskCtx: MaskContext = {
      secretKeys: resolvedEnv?.secretKeys ?? new Set(),
      secretValues: resolvedEnv?.secretValues ?? new Set(),
    };
    const masker = new Masker(maskCtx);

    // Mask each layer's variables before sending to server
    const maskedLayers = layers.map((layer) => ({
      ...layer,
      variables: masker.mask("environment", layer.variables) as Record<string, string>,
    }));

    let executionId = "(not recorded)";
    let executionUrl = "";

    if (recording) {
      // Mask proxy config before sending to server
      let maskedProxy: ProxyConfig | undefined;
      if (proxyConfig) {
        maskedProxy = {
          server: proxyConfig.server,
          bypass: proxyConfig.bypass,
          username: proxyConfig.username ? "***" : undefined,
          password: proxyConfig.password ? "***" : undefined,
        };
      }

      // Create execution on server
      const execution = await this.client.createExecution({
        qa_plan_version_id: planVersionId,
        environment: maskedLayers.length > 0 || maskedProxy
          ? { layers: maskedLayers, proxy: maskedProxy }
          : undefined,
      });
      executionId = execution.id;
      executionUrl = execution.url;
      onExecutionCreated?.(executionId, executionUrl);

      // Start execution
      await this.client.updateExecution(executionId, { status: "running" });
    }

    const allResults: StepResult[] = [];
    let hasFailure = false;
    let hasError = false;

    // Compute total steps for progress tracking
    const totalSteps = plan.scenarios.reduce(
      (sum, s) => sum + s.steps.length,
      0
    );
    let completedStepIndex = 0;

    // Shared state across scenarios
    const globalCompletedSteps = new Map<string, StepResult>();
    let browserStorageState: BrowserStorageState | undefined;

    try {
      for (const scenario of plan.scenarios) {
        const scenarioResult = await this.executeScenario(
          scenario,
          executionId,
          variables,
          masker,
          globalCompletedSteps,
          httpDriver,
          proxyConfig,
          browserStorageState,
          (event) => {
            onStepComplete?.({
              ...event,
              index: completedStepIndex,
              totalSteps,
            });
            completedStepIndex++;
          },
          recording,
        );
        allResults.push(...scenarioResult.results);
        browserStorageState = scenarioResult.browserStorageState ?? browserStorageState;

        for (const r of scenarioResult.results) {
          if (r.status === "failed") hasFailure = true;
          if (r.status === "error") hasError = true;
        }
      }

      const finalStatus = hasError
        ? "error"
        : hasFailure
          ? "failed"
          : "completed";

      if (recording) {
        await this.client.updateExecution(executionId, { status: finalStatus });
      }

      // Compute masked resolved variables for summary
      const maskedResolvedVariables: Record<string, string> = {};
      for (const layer of maskedLayers) {
        Object.assign(maskedResolvedVariables, layer.variables);
      }

      return this.buildSummary(executionId, executionUrl, finalStatus, allResults, maskedResolvedVariables, recording);
    } catch (err) {
      if (recording) {
        await this.client.updateExecution(executionId, { status: "error" });
      }
      throw err;
    }
  }

  private async executeScenario(
    scenario: Scenario,
    executionId: string,
    variables: Record<string, string>,
    masker: Masker,
    completedSteps: Map<string, StepResult>,
    httpDriver: HttpDriver,
    proxyConfig?: ResolvedProxyConfig,
    browserStorageState?: BrowserStorageState,
    onStepComplete?: (event: Omit<StepCompleteEvent, "index" | "totalSteps">) => void,
    recording = true,
  ): Promise<{ results: StepResult[]; browserStorageState?: BrowserStorageState }> {
    const results: StepResult[] = [];

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
          if (recording) {
            await this.reportStep(executionId, scenario.name, step, skippedResult);
          }
          results.push(skippedResult);
          completedSteps.set(step.step_key, skippedResult);
          onStepComplete?.({
            scenarioName: scenario.name,
            stepKey: step.step_key,
            action: step.action,
            status: "skipped",
            errorMessage,
          });
        }
        return { results };
      }
    }

    // Create a browser driver per scenario (shared across browser steps)
    // Restore cookies/localStorage from previous scenarios via storageState
    const hasBrowserSteps = scenario.steps.some((s) => s.action === "browser");
    let browserDriver: BrowserDriver | null = null;
    if (hasBrowserSteps) {
      browserDriver = new BrowserDriver(browserStorageState, proxyConfig);
    }

    // Resolve execution order based on depends_on (within this scenario)
    const ordered = resolveStepOrder(scenario.steps);

    let newBrowserStorageState: BrowserStorageState | undefined;

    try {
      for (const step of ordered) {
        // Check if dependencies are met (includes steps from previous scenarios)
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

          if (recording) {
            await this.reportStep(executionId, scenario.name, step, skippedResult);
          }
          results.push(skippedResult);
          completedSteps.set(step.step_key, skippedResult);
          onStepComplete?.({
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

        // Report step start (only when recording)
        let stepExecId: string | undefined;
        if (recording) {
          const stepExec = await this.client.createStepExecution(executionId, {
            scenario_name: scenario.name,
            step_key: step.step_key,
            action: step.action,
            status: "running",
            step_definition_id: step.id,
          });
          stepExecId = stepExec.id;
        }

        // Execute
        let result: StepResult;
        switch (step.action) {
          case "http_request":
            result = await httpDriver.execute(expandedStep, variables);
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

        // Merge extracted values into shared variables (available to subsequent scenarios)
        if (result.extractedValues) {
          Object.assign(variables, result.extractedValues);
        }

        // Upload artifacts and report assertion results (only when recording)
        if (recording && stepExecId) {
          await this.reportArtifactsAndAssertions(stepExecId, result, expandedStep, masker);

          // Report step result
          await this.client.updateStepExecution(executionId, stepExecId, {
            status: result.status,
            error_message: result.errorMessage,
          });
        }

        results.push(result);
        completedSteps.set(step.step_key, result);

        onStepComplete?.({
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
            if (recording) {
              await this.reportStep(executionId, scenario.name, remaining, skippedResult);
            }
            results.push(skippedResult);
            completedSteps.set(remaining.step_key, skippedResult);
            onStepComplete?.({
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
      // Save browser storage state before closing (for next scenario)
      if (browserDriver) {
        newBrowserStorageState = await browserDriver.getStorageState();
        await browserDriver.close();
      }
    }

    return { results, browserStorageState: newBrowserStorageState };
  }

  private async reportArtifactsAndAssertions(
    stepExecId: string,
    result: StepResult,
    step: Step,
    masker: Masker
  ): Promise<void> {
    // Upload HTTP request/response artifacts
    if (result.response && step.action === "http_request") {
      const config = step.config as { method?: string; url?: string; headers?: Record<string, string>; body?: unknown };

      // Upload request artifact (masked)
      const requestObj = {
        method: config.method,
        url: config.url,
        headers: config.headers,
        body: config.body,
      };
      const maskedRequest = masker.mask("http_request", requestObj);
      const requestData = JSON.stringify(maskedRequest, null, 2);
      try {
        await this.client.uploadArtifact(
          stepExecId,
          "http_request",
          requestData,
          "request.json",
          "application/json",
          { method: config.method, url: config.url }
        );
      } catch {
        // Non-critical: artifact upload failure shouldn't fail the step
      }

      // Upload response artifact (masked)
      const responseObj = {
        status: result.response.status,
        headers: result.response.headers,
        body: result.response.body,
        duration: result.response.duration,
      };
      const maskedResponse = masker.mask("http_response", responseObj);
      const responseData = JSON.stringify(maskedResponse, null, 2);
      try {
        await this.client.uploadArtifact(
          stepExecId,
          "http_response",
          responseData,
          "response.json",
          "application/json",
          { status_code: result.response.status, duration_ms: result.response.duration }
        );
      } catch {
        // Non-critical
      }
    }

    // Upload browser artifacts (screenshots, DOM snapshots)
    if (result.browserArtifacts && result.browserArtifacts.length > 0) {
      for (const artifact of result.browserArtifacts) {
        try {
          let artifactData: Buffer | string = artifact.data;

          // Mask DOM snapshots
          if (artifact.type === "dom_snapshot") {
            const html = artifact.data.toString("utf-8");
            artifactData = Buffer.from(
              masker.mask("dom_snapshot", html) as string,
              "utf-8"
            );
          }

          const ext = artifact.type === "screenshot" ? ".png" : ".html";
          await this.client.uploadArtifact(
            stepExecId,
            artifact.type,
            artifactData,
            `${artifact.name}${ext}`,
            artifact.contentType,
            { name: artifact.name }
          );
        } catch {
          // Non-critical
        }
      }
    }

    // Report assertion results
    if (result.assertionResults && result.assertionResults.length > 0) {
      const assertionPayloads = result.assertionResults.map((ar) => ({
        step_execution_id: stepExecId,
        assertion_type: ar.type,
        expected: ar.expected,
        actual: ar.actual,
        passed: ar.passed,
        message: ar.message,
      }));
      try {
        await this.client.createAssertionResults(assertionPayloads);
      } catch {
        // Non-critical
      }
    }
  }

  private async reportStep(
    executionId: string,
    scenarioName: string,
    step: Step,
    result: StepResult
  ): Promise<void> {
    await this.client.createStepExecution(executionId, {
      scenario_name: scenarioName,
      step_key: step.step_key,
      action: step.action,
      status: result.status,
      error_message: result.errorMessage,
      step_definition_id: step.id,
    });
  }

  private buildSummary(
    executionId: string,
    executionUrl: string,
    status: "completed" | "failed" | "error",
    results: StepResult[],
    resolvedVariables: Record<string, string>,
    recorded: boolean,
  ): ExecutionSummary {
    return {
      executionId,
      executionUrl,
      status,
      totalSteps: results.length,
      passed: results.filter((r) => r.status === "passed").length,
      failed: results.filter((r) => r.status === "failed").length,
      errors: results.filter((r) => r.status === "error").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
      resolvedVariables,
      recorded,
    };
  }
}
