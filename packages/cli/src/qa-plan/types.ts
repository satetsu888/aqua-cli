import { z } from "zod";

export interface QAPlanData {
  name: string;
  description?: string;
  variables?: Record<string, string>;
  scenarios: Scenario[];
}

export interface Scenario {
  id: string;
  name: string;
  requires?: string[];
  sort_order: number;
  steps: Step[];
}

// --- Step Condition Schema ---

export const StepConditionSchema = z.object({
  variable_equals: z.object({
    name: z.string().describe("Variable name to check"),
    value: z.string().describe("Expected value"),
  }).optional(),
  variable_not_equals: z.object({
    name: z.string().describe("Variable name to check"),
    value: z.string().describe("Value that should not match"),
  }).optional(),
}).refine(
  (data) => {
    const keys = [data.variable_equals, data.variable_not_equals].filter(Boolean);
    return keys.length === 1;
  },
  { message: "Exactly one condition type must be specified" }
);

export type StepCondition = z.infer<typeof StepConditionSchema>;

export interface Step {
  id: string; // server-generated ID
  step_key: string; // user-defined identifier
  action: string; // "http_request" | "browser" | plugin action types
  depends_on?: string[]; // references step_keys
  condition?: StepCondition; // conditional execution based on variable values
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: HttpRequestConfig | BrowserConfig | Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertions?: Assertion[] | Record<string, any>[];
  extract?: Record<string, string>; // variable_name -> json_path
  sort_order: number;
}

// --- Step Config Schemas ---

export const PollUntilSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status_code"),
    expected: z.number().describe("Expected HTTP status code"),
  }),
  z.object({
    type: z.literal("json_path"),
    path: z.string().describe("JSONPath expression"),
    expected: z.unknown().describe("Expected value"),
  }),
]);

export const PollConfigSchema = z.object({
  until: PollUntilSchema.describe("Condition to stop polling"),
  interval_ms: z.number().optional().describe("Polling interval in ms (default: 1000)"),
  timeout_ms: z.number().optional().describe("Polling timeout in ms (default: 30000)"),
});

// --- Request Body Schema ---
//
// QA ランナーとしてあらゆる Content-Type のリクエストを送れるよう、body を
// discriminated union で表現する。ランナーはこの type に基づいて body をバイト列に
// 直列化するが、Content-Type を含むヘッダーは一切自動付与しない。
// プランに書かれたヘッダーがそのままワイヤに乗る。

// Note: runtime constraints (e.g. "binary requires exactly one of path/content_base64")
// are enforced by the runner (http.ts buildBody). Keeping them out of Zod here lets us
// use z.discriminatedUnion which requires plain ZodObject branches (not ZodEffects).
export const RequestBodyFileSchema = z.object({
  name: z.string().describe("Form field name"),
  path: z.string().optional().describe("Local file path (relative to cwd)"),
  content: z.string().optional().describe("Inline text content"),
  content_base64: z.string().optional().describe("Inline binary content (Base64-encoded)"),
  filename: z.string().optional().describe("Filename to send in the multipart part"),
  content_type: z.string().optional().describe("Content-Type for this part (e.g. image/png)"),
});

export const RequestBodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("json"),
    value: z.unknown().describe("Any JSON value (object/array/primitive). Will be JSON.stringify-ed"),
  }),
  z.object({
    type: z.literal("form"),
    fields: z.record(z.string())
      .describe("Form fields. Supports {{variable}} templates. URL-encoded by the runner"),
  }),
  z.object({
    type: z.literal("multipart"),
    boundary: z.string().optional()
      .describe("multipart boundary string. If omitted, runner generates one. User must set matching Content-Type header"),
    fields: z.record(z.string()).optional().describe("Text fields"),
    files: z.array(RequestBodyFileSchema).optional().describe("File parts"),
  }),
  z.object({
    type: z.literal("text"),
    value: z.string().describe("Raw string body. Sent as UTF-8 bytes as-is"),
  }),
  z.object({
    type: z.literal("binary"),
    path: z.string().optional().describe("Local file path (relative to cwd)"),
    content_base64: z.string().optional().describe("Inline Base64 content"),
  }),
  z.object({
    type: z.literal("graphql"),
    query: z.string().describe("GraphQL query string"),
    variables: z.record(z.unknown()).optional().describe("GraphQL variables"),
    operationName: z.string().optional().describe("Operation name"),
  }),
]);

export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestBodyFile = z.infer<typeof RequestBodyFileSchema>;

// --- Authentication Helper Schema ---
//
// 認証ヘッダー組み立て用の構造化フィールド。`headers` に直接書くのではなく
// `auth` で意図を表現することで、テンプレート展開された credentials の base64 化
// (basic) や `Bearer` プレフィックス付与 (bearer) を runner が担う。
// discriminated union なので、将来 digest / api_key / sigv4 等を1ブランチで追加できる。
export const HttpAuthSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("basic"),
    username: z.string().describe("Username (supports {{variable}} templates)"),
    password: z.string().describe("Password (supports {{variable}} templates)"),
  }),
  z.object({
    type: z.literal("bearer"),
    token: z.string().describe("Bearer token (supports {{variable}} templates)"),
  }),
]);

export type HttpAuth = z.infer<typeof HttpAuthSchema>;

// Body accepts the new RequestBodySchema, or legacy shapes (object/string/etc.) for
// backwards compatibility. Legacy shapes are normalized at runtime by `normalizeBody`:
// - object → { type: "json", value: ... }
// - string → { type: "text", value: ... }
export const HttpRequestConfigSchema = z.object({
  method: z.string().describe("HTTP method (GET, POST, PUT, DELETE, etc.)"),
  url: z.string().describe("Request URL (supports {{variable}} templates)"),
  headers: z.record(z.string()).optional().describe("Request headers. The runner does NOT auto-inject Content-Type; whatever you put here is sent as-is"),
  body: z.union([RequestBodySchema, z.unknown()]).optional().describe(
    "Request body. Prefer the discriminated form { type: 'json'|'form'|'multipart'|'text'|'binary'|'graphql', ... }. " +
    "Legacy: an arbitrary object is treated as { type: 'json', value: object }, a string as { type: 'text', value: string }."
  ),
  auth: HttpAuthSchema.optional().describe(
    "Authentication helper. The runner builds the corresponding Authorization header. " +
    "Supported types: 'basic' (RFC 7617, base64(user:pass)), 'bearer' (RFC 6750). " +
    "If an explicit Authorization header is also set in `headers`, BOTH headers are sent on the wire (the runner does not deduplicate)."
  ),
  timeout: z.number().optional().describe("Request timeout in ms (default: 30000)"),
  poll: PollConfigSchema.optional().describe("Polling configuration. When set, the request is repeated at interval until the condition is met or timeout is reached"),
  response_body: z.enum(["auto", "text", "binary"]).optional()
    .describe("How to handle the response body. 'auto' (default): decide by Content-Type. 'text': force text decoding. 'binary': force binary handling"),
  max_response_body_size: z.number().optional()
    .describe("Max bytes to read from the response body (default: 52428800 = 50MB). If exceeded, body_truncated is set to true and reading stops"),
});

export const BrowserStepSchema = z.union([
  z.object({ goto: z.string().describe("URL to navigate to") }),
  z.object({ wait_for_selector: z.string().describe("CSS selector to wait for") }),
  z.object({ click: z.string().describe("CSS selector to click") }),
  z.object({
    type: z.object({
      selector: z.string().describe("CSS selector for input field"),
      text: z.string().describe("Text to fill"),
    }),
  }),
  z.object({ screenshot: z.string().describe("Screenshot name") }),
  z.object({ set_header: z.record(z.string()).describe("Extra HTTP headers for subsequent navigations") }),
  z.object({ hover: z.string().describe("CSS selector to hover over") }),
  z.object({
    select_option: z.object({
      selector: z.string().describe("CSS selector for <select> element"),
      value: z.string().describe("Option value to select"),
    }),
  }),
  z.object({ check: z.string().describe("CSS selector for checkbox to check") }),
  z.object({ uncheck: z.string().describe("CSS selector for checkbox to uncheck") }),
  z.object({
    press: z.object({
      selector: z.string().describe("CSS selector for target element"),
      key: z.string().describe("Key to press (e.g. Enter, Tab, Escape)"),
    }),
  }),
  z.object({ wait_for_url: z.string().describe("Substring that the URL should contain") }),
  z.object({ double_click: z.string().describe("CSS selector to double-click") }),
  z.object({ focus: z.string().describe("CSS selector to focus") }),
  z.object({
    upload_file: z.object({
      selector: z.string().describe("CSS selector for file input"),
      path: z.string().describe("File path to upload"),
    }),
  }),
  z.object({ switch_to_frame: z.string().describe("CSS selector for the iframe element to switch into (e.g. 'iframe#payment', 'iframe[name=\"checkout\"]')") }),
  z.object({ switch_to_main_frame: z.literal(true).describe("Switch back to the top-level page frame") }),
]);

export const BrowserConfigSchema = z.object({
  steps: z.array(BrowserStepSchema).describe("Ordered list of browser actions"),
  timeout_ms: z.number().optional().describe("Timeout for each browser action in ms (default: 10000)"),
  viewport: z.enum(["pc", "mobile"]).optional().describe("Viewport preset: 'pc' (1280x720, default) or 'mobile' (375x667)"),
});

export const VIEWPORT_PRESETS: Record<string, { width: number; height: number }> = {
  pc: { width: 1280, height: 720 },
  mobile: { width: 375, height: 667 },
};

export type HttpRequestConfig = z.infer<typeof HttpRequestConfigSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export type BrowserStep = z.infer<typeof BrowserStepSchema>;
export type PollConfig = z.infer<typeof PollConfigSchema>;
export type PollUntil = z.infer<typeof PollUntilSchema>;

// --- HTTP Assertion Schemas ---

export const StatusCodeAssertionSchema = z.object({
  type: z.literal("status_code"),
  expected: z.number().describe("Expected HTTP status code"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const StatusCodeInAssertionSchema = z.object({
  type: z.literal("status_code_in"),
  expected: z.array(z.number()).describe("List of acceptable HTTP status codes"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const JsonPathAssertionSchema = z.object({
  type: z.literal("json_path"),
  path: z.string().describe("JSONPath expression (e.g. $.data.id)"),
  condition: z
    .enum(["exists", "not_exists", "contains"])
    .optional()
    .describe(
      "Condition to evaluate. Omit for exact value match (equals). contains: checks if the string value at the path includes the expected string as a substring."
    ),
  expected: z
    .unknown()
    .optional()
    .describe("Expected value (required for equals/contains, unused for exists/not_exists)"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const HeaderAssertionSchema = z.object({
  type: z.literal("header"),
  name: z.string().describe("Header name (case-insensitive)"),
  condition: z.enum(["equals", "contains", "exists", "not_exists", "matches"])
    .optional()
    .describe("Match condition. Default: equals. matches: regular expression"),
  expected: z.string().optional()
    .describe("Expected value (required for equals/contains/matches; unused for exists/not_exists)"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const BodySizeAssertionSchema = z.object({
  type: z.literal("body_size"),
  condition: z.enum(["equals", "greater_than", "less_than", "between"])
    .optional().describe("Comparison condition. Default: equals"),
  expected: z.union([z.number(), z.tuple([z.number(), z.number()])])
    .describe("Numeric expected size in bytes. For 'between', a [min, max] tuple"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const BodyHashAssertionSchema = z.object({
  type: z.literal("body_hash"),
  algorithm: z.enum(["sha256", "md5"]).optional()
    .describe("Hash algorithm. Default: sha256"),
  expected: z.string().describe("Expected hex digest"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const BodyContainsAssertionSchema = z.object({
  type: z.literal("body_contains"),
  expected: z.string().describe("Substring expected to appear in the (text) response body. Always fails for binary responses"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const HttpAssertionSchema = z.discriminatedUnion("type", [
  StatusCodeAssertionSchema,
  StatusCodeInAssertionSchema,
  JsonPathAssertionSchema,
  HeaderAssertionSchema,
  BodySizeAssertionSchema,
  BodyHashAssertionSchema,
  BodyContainsAssertionSchema,
]);

// --- Browser Assertion Schemas ---

export const ElementTextAssertionSchema = z.object({
  type: z.literal("element_text"),
  selector: z.string().describe("CSS selector for the element"),
  contains: z
    .string()
    .optional()
    .describe("Substring to check in element text. Omit to just check text exists"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const ElementVisibleAssertionSchema = z.object({
  type: z.literal("element_visible"),
  selector: z.string().describe("CSS selector for the element"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const ScreenshotAssertionSchema = z.object({
  type: z.literal("screenshot"),
  name: z.string().optional().describe("Screenshot name"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const UrlContainsAssertionSchema = z.object({
  type: z.literal("url_contains"),
  expected: z.string().describe("Substring that current URL should contain"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const TitleAssertionSchema = z.object({
  type: z.literal("title"),
  expected: z.string().describe("Expected exact page title"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const ElementNotVisibleAssertionSchema = z.object({
  type: z.literal("element_not_visible"),
  selector: z.string().describe("CSS selector for the element"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const ElementCountAssertionSchema = z.object({
  type: z.literal("element_count"),
  selector: z.string().describe("CSS selector to count matching elements"),
  expected: z.number().describe("Expected number of matching elements"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const ElementAttributeAssertionSchema = z.object({
  type: z.literal("element_attribute"),
  selector: z.string().describe("CSS selector for the element"),
  attribute: z.string().describe("Attribute name to check"),
  expected: z.string().describe("Expected attribute value"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const CookieExistsAssertionSchema = z.object({
  type: z.literal("cookie_exists"),
  name: z.string().describe("Cookie name to check"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const CookieValueAssertionSchema = z.object({
  type: z.literal("cookie_value"),
  name: z.string().describe("Cookie name to check"),
  expected: z.string().describe("Expected cookie value"),
  match: z
    .enum(["exact", "contains"])
    .optional()
    .describe("Match mode (default: exact)"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const LocalStorageExistsAssertionSchema = z.object({
  type: z.literal("localstorage_exists"),
  key: z.string().describe("localStorage key to check"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const LocalStorageValueAssertionSchema = z.object({
  type: z.literal("localstorage_value"),
  key: z.string().describe("localStorage key to check"),
  expected: z.string().describe("Expected localStorage value"),
  match: z
    .enum(["exact", "contains"])
    .optional()
    .describe("Match mode (default: exact)"),
  description: z.string().optional().describe("Human-readable description of what this assertion verifies"),
});

export const BrowserAssertionSchema = z.discriminatedUnion("type", [
  ElementTextAssertionSchema,
  ElementVisibleAssertionSchema,
  ElementNotVisibleAssertionSchema,
  ScreenshotAssertionSchema,
  UrlContainsAssertionSchema,
  TitleAssertionSchema,
  ElementCountAssertionSchema,
  ElementAttributeAssertionSchema,
  CookieExistsAssertionSchema,
  CookieValueAssertionSchema,
  LocalStorageExistsAssertionSchema,
  LocalStorageValueAssertionSchema,
]);

// --- Combined ---

export const AssertionSchema = z.discriminatedUnion("type", [
  StatusCodeAssertionSchema,
  StatusCodeInAssertionSchema,
  JsonPathAssertionSchema,
  HeaderAssertionSchema,
  BodySizeAssertionSchema,
  BodyHashAssertionSchema,
  BodyContainsAssertionSchema,
  ElementTextAssertionSchema,
  ElementVisibleAssertionSchema,
  ElementNotVisibleAssertionSchema,
  ScreenshotAssertionSchema,
  UrlContainsAssertionSchema,
  TitleAssertionSchema,
  ElementCountAssertionSchema,
  ElementAttributeAssertionSchema,
  CookieExistsAssertionSchema,
  CookieValueAssertionSchema,
  LocalStorageExistsAssertionSchema,
  LocalStorageValueAssertionSchema,
]);

// --- Derived Types ---

export type StatusCodeAssertion = z.infer<typeof StatusCodeAssertionSchema>;
export type StatusCodeInAssertion = z.infer<typeof StatusCodeInAssertionSchema>;
export type JsonPathAssertion = z.infer<typeof JsonPathAssertionSchema>;
export type HeaderAssertion = z.infer<typeof HeaderAssertionSchema>;
export type BodySizeAssertion = z.infer<typeof BodySizeAssertionSchema>;
export type BodyHashAssertion = z.infer<typeof BodyHashAssertionSchema>;
export type BodyContainsAssertion = z.infer<typeof BodyContainsAssertionSchema>;
export type HttpAssertion = z.infer<typeof HttpAssertionSchema>;

export type ElementTextAssertion = z.infer<typeof ElementTextAssertionSchema>;
export type ElementVisibleAssertion = z.infer<typeof ElementVisibleAssertionSchema>;
export type ElementNotVisibleAssertion = z.infer<typeof ElementNotVisibleAssertionSchema>;
export type ScreenshotAssertion = z.infer<typeof ScreenshotAssertionSchema>;
export type UrlContainsAssertion = z.infer<typeof UrlContainsAssertionSchema>;
export type TitleAssertion = z.infer<typeof TitleAssertionSchema>;
export type ElementCountAssertion = z.infer<typeof ElementCountAssertionSchema>;
export type ElementAttributeAssertion = z.infer<typeof ElementAttributeAssertionSchema>;
export type CookieExistsAssertion = z.infer<typeof CookieExistsAssertionSchema>;
export type CookieValueAssertion = z.infer<typeof CookieValueAssertionSchema>;
export type LocalStorageExistsAssertion = z.infer<typeof LocalStorageExistsAssertionSchema>;
export type LocalStorageValueAssertion = z.infer<typeof LocalStorageValueAssertionSchema>;
export type BrowserAssertion = z.infer<typeof BrowserAssertionSchema>;

export type Assertion = z.infer<typeof AssertionSchema>;

export interface BrowserArtifact {
  name: string;
  type: "screenshot" | "dom_snapshot";
  contentType: string;
  data: Buffer;
}

export interface StepResult {
  stepKey: string;
  scenarioName: string;
  action: string;
  status: "passed" | "failed" | "error" | "skipped";
  errorMessage?: string;
  response?: HttpResponse;
  extractedValues?: Record<string, string>;
  assertionResults?: AssertionResultData[];
  browserArtifacts?: BrowserArtifact[];
  abortScenario?: boolean;
  startedAt: Date;
  finishedAt: Date;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  /** UTF-8 decoded body for text responses; empty string for binary. */
  body: string;
  /** Raw bytes; only set for binary responses. */
  body_bytes?: Buffer;
  /**
   * Total bytes received (may be less than wire size if truncated).
   * Optional so plugin actions that synthesize a fake response don't have to
   * fill this in; the HTTP driver always populates it.
   */
  body_size?: number;
  /**
   * SHA-256 hex digest of the received bytes. Set by the HTTP driver; plugin
   * synthesized responses may omit it.
   */
  body_sha256?: string;
  /** True if reading stopped because max_response_body_size was exceeded. */
  body_truncated?: boolean;
  /** Lower-cased MIME (without parameters) from the Content-Type header. */
  content_type?: string;
  /** Whether the response was treated as binary. Defaults to false when absent. */
  is_binary?: boolean;
  duration: number; // ms
}

export interface AssertionResultData {
  type: string;
  expected?: string;
  actual?: string;
  passed: boolean;
  message?: string;
  step_assertion_id?: string;
}
