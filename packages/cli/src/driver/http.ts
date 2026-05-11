import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import type { Driver } from "./types.js";
import type {
  Step,
  StepResult,
  HttpRequestConfig,
  HttpResponse,
  PollUntil,
  AssertionResultData,
  RequestBody,
} from "../qa-plan/types.js";
import type { ResolvedProxyConfig } from "../environment/types.js";
import { expandObject } from "../utils/template.js";
import { getJsonPath } from "../plugin/utils.js";
import { ProxyAgent } from "undici";
import { parseBypassPatterns, shouldBypassProxy } from "./proxy-bypass.js";

const KNOWN_BODY_TYPES = new Set([
  "json",
  "form",
  "multipart",
  "text",
  "binary",
  "graphql",
]);

const DEFAULT_MAX_RESPONSE_BODY_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Decide whether a Content-Type indicates a text response that can safely be
 * decoded as UTF-8 and shown in assertions/extracts as a string.
 *
 * Anything not explicitly recognized as text is treated as binary so that
 * arbitrary bytes (PDF, images, archives, etc.) don't get mangled by UTF-8
 * decoding.
 */
export function isTextContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    // Servers that omit Content-Type usually return text (or nothing). Treat
    // as text so the user sees the body rather than a binary placeholder.
    return true;
  }
  const lower = contentType.toLowerCase().split(";")[0].trim();
  if (lower.startsWith("text/")) return true;
  if (lower === "application/json") return true;
  if (lower === "application/xml") return true;
  if (lower === "application/javascript" || lower === "application/ecmascript") return true;
  if (lower === "application/x-www-form-urlencoded") return true;
  if (lower === "application/ld+json" || lower === "application/problem+json") return true;
  if (/^application\/[a-z0-9.-]+\+(json|xml)$/.test(lower)) return true;
  return false;
}

/** Extract the MIME part (lower-cased, no parameters) from a Content-Type header. */
function parseContentTypeMime(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined;
  return contentType.toLowerCase().split(";")[0].trim() || undefined;
}

interface ReadBodyResult {
  bytes: Buffer;
  size: number;
  sha256: string;
  truncated: boolean;
}

/**
 * Read the response body from a fetch Response with a streaming hash and a
 * size cap. Always computes sha256 over the bytes actually read.
 */
export async function readResponseBody(
  res: Response,
  maxSize: number
): Promise<ReadBodyResult> {
  // Fallback for mock Response objects that don't provide a stream body.
  if (!res.body) {
    if (typeof res.text === "function") {
      const text = await res.text();
      const bytes = Buffer.from(text, "utf-8");
      let kept = bytes;
      let truncated = false;
      if (bytes.length > maxSize) {
        kept = bytes.subarray(0, maxSize);
        truncated = true;
      }
      return {
        bytes: kept,
        size: kept.length,
        sha256: createHash("sha256").update(kept).digest("hex"),
        truncated,
      };
    }
    return {
      bytes: Buffer.alloc(0),
      size: 0,
      sha256: createHash("sha256").digest("hex"),
      truncated: false,
    };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  const hasher = createHash("sha256");
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > maxSize) {
      // Keep up to maxSize bytes, drop the rest.
      const remaining = Math.max(0, maxSize - size);
      if (remaining > 0) {
        const slice = value.subarray(0, remaining);
        chunks.push(slice);
        hasher.update(slice);
        size += slice.length;
      }
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      break;
    }
    chunks.push(value);
    hasher.update(value);
    size += value.length;
  }
  return {
    bytes: Buffer.concat(chunks),
    size,
    sha256: hasher.digest("hex"),
    truncated,
  };
}

/**
 * Normalize legacy body shapes into the discriminated RequestBody form.
 * - `{ type: "json"|... }` is passed through
 * - string → { type: "text", value: string }
 * - other object → { type: "json", value: object }
 * - null/undefined → undefined
 */
export function normalizeBody(body: unknown): RequestBody | undefined {
  if (body === undefined || body === null) return undefined;
  if (
    typeof body === "object" &&
    body !== null &&
    "type" in body &&
    typeof (body as { type: unknown }).type === "string" &&
    KNOWN_BODY_TYPES.has((body as { type: string }).type)
  ) {
    return body as RequestBody;
  }
  if (typeof body === "string") {
    return { type: "text", value: body };
  }
  return { type: "json", value: body };
}

/**
 * Serialize a (normalized) RequestBody into bytes for the wire.
 * Headers are NOT touched here — that is the caller's (i.e. plan author's)
 * responsibility, per the "send the plan as-is" principle.
 */
export async function buildBody(
  body: RequestBody
): Promise<string | Buffer> {
  switch (body.type) {
    case "json":
      return JSON.stringify(body.value);
    case "form": {
      // We intentionally produce a string (not a URLSearchParams instance) so that
      // undici's fetch does NOT auto-inject `Content-Type: application/x-www-form-urlencoded`.
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body.fields)) {
        params.append(k, String(v));
      }
      return params.toString();
    }
    case "multipart": {
      const boundary = body.boundary ?? `----aqua-${randomBytes(12).toString("hex")}`;
      return await buildMultipart(boundary, body.fields, body.files);
    }
    case "text":
      return body.value;
    case "binary":
      if (body.path !== undefined) {
        return await readFile(body.path);
      }
      if (body.content_base64 !== undefined) {
        return Buffer.from(body.content_base64, "base64");
      }
      throw new Error("binary body must specify either path or content_base64");
    case "graphql":
      return JSON.stringify({
        query: body.query,
        variables: body.variables,
        operationName: body.operationName,
      });
    default: {
      const _exhaustive: never = body;
      throw new Error(`Unknown body type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

async function buildMultipart(
  boundary: string,
  fields: Record<string, string> | undefined,
  files: Array<{
    name: string;
    path?: string;
    content?: string;
    content_base64?: string;
    filename?: string;
    content_type?: string;
  }> | undefined
): Promise<Buffer> {
  const parts: Buffer[] = [];
  const CRLF = "\r\n";

  if (fields) {
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
            `${value}${CRLF}`
        )
      );
    }
  }

  if (files) {
    for (const file of files) {
      const filename = file.filename ?? file.name;
      const contentType = file.content_type ?? "application/octet-stream";
      let content: Buffer;
      if (file.path !== undefined) {
        content = await readFile(file.path);
      } else if (file.content !== undefined) {
        content = Buffer.from(file.content, "utf-8");
      } else if (file.content_base64 !== undefined) {
        content = Buffer.from(file.content_base64, "base64");
      } else {
        throw new Error(
          `multipart file "${file.name}" must specify one of path / content / content_base64`
        );
      }
      parts.push(
        Buffer.from(
          `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="${file.name}"; filename="${filename}"${CRLF}` +
            `Content-Type: ${contentType}${CRLF}${CRLF}`
        )
      );
      parts.push(content);
      parts.push(Buffer.from(CRLF));
    }
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`));
  return Buffer.concat(parts);
}

export class HttpDriver implements Driver {
  private proxyDispatcher: ProxyAgent | undefined;
  private bypassPatterns: string[] = [];

  constructor(proxyConfig?: ResolvedProxyConfig) {
    if (proxyConfig) {
      this.initProxy(proxyConfig);
      if (proxyConfig.bypass) {
        this.bypassPatterns = parseBypassPatterns(proxyConfig.bypass);
      }
    }
  }

  private initProxy(config: ResolvedProxyConfig): void {
    const token =
      config.username && config.password
        ? `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`
        : undefined;

    const requestTls: Record<string, unknown> = {};
    if (config.caCert) {
      requestTls.ca = config.caCert;
    }
    if (config.rejectUnauthorized !== undefined) {
      requestTls.rejectUnauthorized = config.rejectUnauthorized;
    }

    const proxyTls: Record<string, unknown> = {};
    if (config.proxyCaCert) {
      proxyTls.ca = config.proxyCaCert;
    }
    if (config.rejectUnauthorized !== undefined) {
      proxyTls.rejectUnauthorized = config.rejectUnauthorized;
    }

    this.proxyDispatcher = new ProxyAgent({
      uri: config.server,
      token,
      ...(Object.keys(requestTls).length > 0 && { requestTls }),
      ...(Object.keys(proxyTls).length > 0 && { proxyTls }),
    });
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
      const normalized = normalizeBody(config.body);
      const wireBody = normalized ? await buildBody(normalized) : undefined;

      const fetchOpts: Record<string, unknown> = {
        method: config.method,
        headers: config.headers,
        body: wireBody,
        signal: controller.signal,
      };
      if (this.proxyDispatcher && !shouldBypassProxy(config.url, this.bypassPatterns)) {
        fetchOpts.dispatcher = this.proxyDispatcher;
      }
      const res = await fetch(config.url, fetchOpts as RequestInit);

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const mime = parseContentTypeMime(headers["content-type"]);
      const mode = config.response_body ?? "auto";
      const isBinary =
        mode === "binary"
          ? true
          : mode === "text"
            ? false
            : !isTextContentType(headers["content-type"]);

      const maxSize = config.max_response_body_size ?? DEFAULT_MAX_RESPONSE_BODY_SIZE;
      const read = await readResponseBody(res, maxSize);
      const duration = Date.now() - start;

      const response: HttpResponse = {
        status: res.status,
        headers,
        body: isBinary ? "" : read.bytes.toString("utf-8"),
        body_size: read.size,
        body_sha256: read.sha256,
        is_binary: isBinary,
        duration,
      };
      if (isBinary) {
        response.body_bytes = read.bytes;
      }
      if (read.truncated) {
        response.body_truncated = true;
      }
      if (mime) {
        response.content_type = mime;
      }
      return response;
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
          result = this.assertStatusCode(response, assertion.expected as number);
          break;
        case "status_code_in":
          result = this.assertStatusCodeIn(response, assertion.expected as number[]);
          break;
        case "json_path":
          result = this.assertJsonPath(
            response,
            (assertion as { path: string }).path,
            (assertion as { condition?: "exists" | "not_exists" | "contains" }).condition,
            (assertion as { expected?: unknown }).expected
          );
          break;
        case "header":
          result = this.assertHeader(
            response,
            (assertion as { name: string }).name,
            (assertion as { condition?: "equals" | "contains" | "exists" | "not_exists" | "matches" }).condition,
            (assertion as { expected?: string }).expected
          );
          break;
        case "body_size":
          result = this.assertBodySize(
            response,
            (assertion as { condition?: "equals" | "greater_than" | "less_than" | "between" }).condition,
            (assertion as { expected: number | [number, number] }).expected
          );
          break;
        case "body_hash":
          result = this.assertBodyHash(
            response,
            (assertion as { algorithm?: "sha256" | "md5" }).algorithm,
            (assertion as { expected: string }).expected
          );
          break;
        case "body_contains":
          result = this.assertBodyContains(
            response,
            (assertion as { expected: string }).expected
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
    if (response.is_binary) {
      return {
        type: "json_path",
        passed: false,
        message: "Cannot apply json_path to a binary response body",
      };
    }
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
    if (response.is_binary) return undefined;

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

  private assertHeader(
    response: HttpResponse,
    name: string,
    condition: "equals" | "contains" | "exists" | "not_exists" | "matches" | undefined,
    expected: string | undefined
  ): AssertionResultData {
    const lowerName = name.toLowerCase();
    // headers are stored lower-cased by fetch's Headers.forEach
    const actual = Object.entries(response.headers).find(
      ([k]) => k.toLowerCase() === lowerName
    )?.[1];
    const cond = condition ?? "equals";

    switch (cond) {
      case "exists":
        return {
          type: "header",
          expected: `${name} exists`,
          actual: actual !== undefined ? "exists" : "missing",
          passed: actual !== undefined,
        };
      case "not_exists":
        return {
          type: "header",
          expected: `${name} not exists`,
          actual: actual !== undefined ? "exists" : "missing",
          passed: actual === undefined,
        };
      case "contains":
        return {
          type: "header",
          expected: `${name} contains ${expected ?? ""}`,
          actual: actual ?? "<missing>",
          passed: actual !== undefined && actual.includes(expected ?? ""),
        };
      case "matches": {
        if (actual === undefined) {
          return {
            type: "header",
            expected: `${name} matches /${expected ?? ""}/`,
            actual: "<missing>",
            passed: false,
            message: `Header ${name} is missing`,
          };
        }
        try {
          const re = new RegExp(expected ?? "");
          return {
            type: "header",
            expected: `${name} matches /${expected ?? ""}/`,
            actual,
            passed: re.test(actual),
          };
        } catch (e) {
          return {
            type: "header",
            passed: false,
            message: `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }
      case "equals":
      default:
        return {
          type: "header",
          expected: expected ?? "",
          actual: actual ?? "<missing>",
          passed: actual === expected,
        };
    }
  }

  private assertBodySize(
    response: HttpResponse,
    condition: "equals" | "greater_than" | "less_than" | "between" | undefined,
    expected: number | [number, number]
  ): AssertionResultData {
    const size = response.body_size;
    if (size === undefined) {
      return {
        type: "body_size",
        passed: false,
        message: "Response has no body_size (plugin-synthesized response?)",
      };
    }
    const cond = condition ?? "equals";
    switch (cond) {
      case "greater_than": {
        const n = expected as number;
        return {
          type: "body_size",
          expected: `> ${n}`,
          actual: String(size),
          passed: size > n,
        };
      }
      case "less_than": {
        const n = expected as number;
        return {
          type: "body_size",
          expected: `< ${n}`,
          actual: String(size),
          passed: size < n,
        };
      }
      case "between": {
        const [min, max] = expected as [number, number];
        return {
          type: "body_size",
          expected: `${min}..${max}`,
          actual: String(size),
          passed: size >= min && size <= max,
        };
      }
      case "equals":
      default: {
        const n = expected as number;
        return {
          type: "body_size",
          expected: String(n),
          actual: String(size),
          passed: size === n,
        };
      }
    }
  }

  private assertBodyHash(
    response: HttpResponse,
    algorithm: "sha256" | "md5" | undefined,
    expected: string
  ): AssertionResultData {
    const algo = algorithm ?? "sha256";
    let actual: string;
    if (algo === "sha256") {
      if (response.body_sha256 === undefined) {
        return {
          type: "body_hash",
          passed: false,
          message: "Response has no body_sha256 (plugin-synthesized response?)",
        };
      }
      actual = response.body_sha256;
    } else {
      // md5: re-hash from body_bytes or body. body_sha256 is sha256 only.
      const src = response.is_binary
        ? response.body_bytes ?? Buffer.alloc(0)
        : Buffer.from(response.body, "utf-8");
      actual = createHash("md5").update(src).digest("hex");
    }
    return {
      type: "body_hash",
      expected: `${algo}:${expected}`,
      actual: `${algo}:${actual}`,
      passed: actual.toLowerCase() === expected.toLowerCase(),
    };
  }

  private assertBodyContains(
    response: HttpResponse,
    expected: string
  ): AssertionResultData {
    if (response.is_binary) {
      return {
        type: "body_contains",
        expected,
        passed: false,
        message: "Cannot apply body_contains to a binary response body",
      };
    }
    return {
      type: "body_contains",
      expected,
      actual: response.body.length > 200
        ? `${response.body.slice(0, 200)}...(truncated)`
        : response.body,
      passed: response.body.includes(expected),
    };
  }
}

