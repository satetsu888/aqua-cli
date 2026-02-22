import type { Driver } from "./types.js";
import type {
  Step,
  StepResult,
  HttpRequestConfig,
  HttpResponse,
  PollUntil,
  AssertionResultData,
} from "../qa-plan/types.js";
import type { ResolvedProxyConfig } from "../environment/types.js";
import { expandObject } from "../utils/template.js";
import { ProxyAgent } from "undici";

export class HttpDriver implements Driver {
  private proxyDispatcher: ProxyAgent | undefined;

  constructor(proxyConfig?: ResolvedProxyConfig) {
    if (proxyConfig) {
      this.initProxy(proxyConfig);
    }
  }

  private initProxy(config: ResolvedProxyConfig): void {
    const token =
      config.username && config.password
        ? `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`
        : undefined;
    this.proxyDispatcher = new ProxyAgent({ uri: config.server, token });
  }

  async execute(
    step: Step,
    variables: Record<string, string>
  ): Promise<StepResult> {
    const startedAt = new Date();
    const config = expandObject(step.config as HttpRequestConfig, variables);

    try {
      if (config.poll) {
        return await this.executePoll(step, config, startedAt);
      }

      const response = await this.sendRequest(config);
      const assertionResults = this.evaluateAssertions(step, response);

      const allPassed = assertionResults.every((a) => a.passed);
      const extractedValues = this.extractValues(step, response);

      return {
        stepKey: step.step_key,
        scenarioName: "",
        action: step.action,
        status: allPassed ? "passed" : "failed",
        response,
        extractedValues,
        assertionResults,
        startedAt,
        finishedAt: new Date(),
      };
    } catch (err) {
      return {
        stepKey: step.step_key,
        scenarioName: "",
        action: step.action,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        startedAt,
        finishedAt: new Date(),
      };
    }
  }

  private async executePoll(
    step: Step,
    config: HttpRequestConfig,
    startedAt: Date
  ): Promise<StepResult> {
    const poll = config.poll!;
    const interval = poll.interval_ms ?? 1000;
    const timeout = poll.timeout_ms ?? 30000;
    const deadline = Date.now() + timeout;

    // Build a non-polling config for each request
    const requestConfig: HttpRequestConfig = {
      method: config.method,
      url: config.url,
      headers: config.headers,
      body: config.body,
      timeout: config.timeout,
    };

    let lastResponse: HttpResponse | undefined;
    let attempts = 0;

    while (Date.now() < deadline) {
      attempts++;
      try {
        lastResponse = await this.sendRequest(requestConfig);
      } catch {
        // Request failed — continue polling
        if (Date.now() + interval < deadline) {
          await this.sleep(interval);
          continue;
        }
        break;
      }

      if (this.checkPollUntil(poll.until, lastResponse)) {
        const assertionResults = this.evaluateAssertions(step, lastResponse);
        const allPassed = assertionResults.length === 0 || assertionResults.every((a) => a.passed);
        const extractedValues = this.extractValues(step, lastResponse);

        return {
          stepKey: step.step_key,
          scenarioName: "",
          action: step.action,
          status: allPassed ? "passed" : "failed",
          response: lastResponse,
          extractedValues,
          assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
          startedAt,
          finishedAt: new Date(),
        };
      }

      if (Date.now() + interval < deadline) {
        await this.sleep(interval);
      } else {
        break;
      }
    }

    return {
      stepKey: step.step_key,
      scenarioName: "",
      action: step.action,
      status: "failed",
      errorMessage: `Polling timed out after ${timeout}ms (${attempts} attempts)`,
      response: lastResponse,
      startedAt,
      finishedAt: new Date(),
    };
  }

  private checkPollUntil(until: PollUntil, response: HttpResponse): boolean {
    switch (until.type) {
      case "status_code":
        return response.status === until.expected;
      case "json_path": {
        try {
          const json = JSON.parse(response.body);
          const value = getJsonPath(json, until.path);
          return String(value) === String(until.expected);
        } catch {
          return false;
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendRequest(config: HttpRequestConfig): Promise<HttpResponse> {
    const timeout = config.timeout ?? 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const start = Date.now();
    try {
      const fetchOpts: Record<string, unknown> = {
        method: config.method,
        headers: config.headers,
        body: config.body ? JSON.stringify(config.body) : undefined,
        signal: controller.signal,
      };
      if (this.proxyDispatcher) {
        fetchOpts.dispatcher = this.proxyDispatcher;
      }
      const res = await fetch(config.url, fetchOpts as RequestInit);

      const duration = Date.now() - start;
      const body = await res.text();

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return { status: res.status, headers, body, duration };
    } finally {
      clearTimeout(timer);
    }
  }

  private evaluateAssertions(
    step: Step,
    response: HttpResponse
  ): AssertionResultData[] {
    if (!step.assertions) return [];

    return step.assertions.map((assertion) => {
      let result: AssertionResultData;
      switch (assertion.type) {
        case "status_code":
          result = this.assertStatusCode(response, assertion.expected);
          break;
        case "status_code_in":
          result = this.assertStatusCodeIn(response, assertion.expected);
          break;
        case "json_path":
          result = this.assertJsonPath(
            response,
            assertion.path,
            assertion.condition,
            assertion.expected
          );
          break;
        default:
          result = {
            type: assertion.type,
            passed: false,
            message: `Unknown assertion type: ${assertion.type}`,
          };
      }
      if ((assertion as Record<string, unknown>).id) {
        result.step_assertion_id = (assertion as Record<string, unknown>).id as string;
      }
      return result;
    });
  }

  private assertStatusCode(
    response: HttpResponse,
    expected: number
  ): AssertionResultData {
    return {
      type: "status_code",
      expected: String(expected),
      actual: String(response.status),
      passed: response.status === expected,
      message:
        response.status === expected
          ? undefined
          : `Expected status ${expected}, got ${response.status}`,
    };
  }

  private assertStatusCodeIn(
    response: HttpResponse,
    expected: number[]
  ): AssertionResultData {
    const passed = expected.includes(response.status);
    return {
      type: "status_code_in",
      expected: expected.join(", "),
      actual: String(response.status),
      passed,
      message: passed
        ? undefined
        : `Expected status to be one of [${expected.join(", ")}], got ${response.status}`,
    };
  }

  private assertJsonPath(
    response: HttpResponse,
    path: string,
    condition?: "exists" | "not_exists" | "contains",
    expected?: unknown
  ): AssertionResultData {
    try {
      const json = JSON.parse(response.body);
      const value = getJsonPath(json, path);

      switch (condition) {
        case "exists":
          return {
            type: "json_path",
            expected: `${path} exists`,
            actual: value !== undefined ? "exists" : "not found",
            passed: value !== undefined,
          };
        case "not_exists":
          return {
            type: "json_path",
            expected: `${path} not exists`,
            actual: value !== undefined ? "exists" : "not found",
            passed: value === undefined,
          };
        case "contains":
          return {
            type: "json_path",
            expected: `${path} contains ${expected}`,
            actual: String(value),
            passed:
              typeof value === "string" && value.includes(String(expected)),
          };
        default: {
          // equals
          const actual = typeof value === "object" ? JSON.stringify(value) : String(value);
          const exp = String(expected);
          return {
            type: "json_path",
            expected: exp,
            actual,
            passed: actual === exp,
          };
        }
      }
    } catch {
      return {
        type: "json_path",
        passed: false,
        message: "Response body is not valid JSON",
      };
    }
  }

  private extractValues(
    step: Step,
    response: HttpResponse
  ): Record<string, string> | undefined {
    if (!step.extract) return undefined;

    try {
      const json = JSON.parse(response.body);
      const values: Record<string, string> = {};
      for (const [varName, jsonPath] of Object.entries(step.extract)) {
        const value = getJsonPath(json, jsonPath);
        if (value !== undefined) {
          values[varName] = String(value);
        }
      }
      return values;
    } catch {
      return undefined;
    }
  }
}

/**
 * Simple JSONPath resolver. Supports $.foo.bar and $.foo[0].bar syntax.
 */
function getJsonPath(obj: unknown, path: string): unknown {
  const parts = path
    .replace(/^\$\.?/, "")
    .split(/\.|\[(\d+)\]/)
    .filter(Boolean);

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}
