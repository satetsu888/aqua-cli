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

export interface Step {
  id: string; // server-generated ID
  step_key: string; // user-defined identifier
  action: "http_request" | "browser";
  depends_on?: string[]; // references step_keys
  config: HttpRequestConfig | BrowserConfig;
  assertions?: Assertion[];
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

export const HttpRequestConfigSchema = z.object({
  method: z.string().describe("HTTP method (GET, POST, PUT, DELETE, etc.)"),
  url: z.string().describe("Request URL (supports {{variable}} templates)"),
  headers: z.record(z.string()).optional().describe("Request headers"),
  body: z.unknown().optional().describe("Request body (will be JSON-serialized)"),
  timeout: z.number().optional().describe("Request timeout in ms (default: 30000)"),
  poll: PollConfigSchema.optional().describe("Polling configuration. When set, the request is repeated at interval until the condition is met or timeout is reached"),
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
]);

export const BrowserConfigSchema = z.object({
  steps: z.array(BrowserStepSchema).describe("Ordered list of browser actions"),
  timeout_ms: z.number().optional().describe("Timeout for each browser action in ms (default: 10000)"),
});

export type HttpRequestConfig = z.infer<typeof HttpRequestConfigSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export type BrowserStep = z.infer<typeof BrowserStepSchema>;
export type PollConfig = z.infer<typeof PollConfigSchema>;
export type PollUntil = z.infer<typeof PollUntilSchema>;

// --- HTTP Assertion Schemas ---

export const StatusCodeAssertionSchema = z.object({
  type: z.literal("status_code"),
  expected: z.number().describe("Expected HTTP status code"),
});

export const StatusCodeInAssertionSchema = z.object({
  type: z.literal("status_code_in"),
  expected: z.array(z.number()).describe("List of acceptable HTTP status codes"),
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
});

export const HttpAssertionSchema = z.discriminatedUnion("type", [
  StatusCodeAssertionSchema,
  StatusCodeInAssertionSchema,
  JsonPathAssertionSchema,
]);

// --- Browser Assertion Schemas ---

export const ElementTextAssertionSchema = z.object({
  type: z.literal("element_text"),
  selector: z.string().describe("CSS selector for the element"),
  contains: z
    .string()
    .optional()
    .describe("Substring to check in element text. Omit to just check text exists"),
});

export const ElementVisibleAssertionSchema = z.object({
  type: z.literal("element_visible"),
  selector: z.string().describe("CSS selector for the element"),
});

export const ScreenshotAssertionSchema = z.object({
  type: z.literal("screenshot"),
  name: z.string().optional().describe("Screenshot name"),
  description: z.string().optional().describe("Screenshot description"),
});

export const UrlContainsAssertionSchema = z.object({
  type: z.literal("url_contains"),
  expected: z.string().describe("Substring that current URL should contain"),
});

export const TitleAssertionSchema = z.object({
  type: z.literal("title"),
  expected: z.string().describe("Expected exact page title"),
});

export const ElementNotVisibleAssertionSchema = z.object({
  type: z.literal("element_not_visible"),
  selector: z.string().describe("CSS selector for the element"),
});

export const ElementCountAssertionSchema = z.object({
  type: z.literal("element_count"),
  selector: z.string().describe("CSS selector to count matching elements"),
  expected: z.number().describe("Expected number of matching elements"),
});

export const ElementAttributeAssertionSchema = z.object({
  type: z.literal("element_attribute"),
  selector: z.string().describe("CSS selector for the element"),
  attribute: z.string().describe("Attribute name to check"),
  expected: z.string().describe("Expected attribute value"),
});

export const CookieExistsAssertionSchema = z.object({
  type: z.literal("cookie_exists"),
  name: z.string().describe("Cookie name to check"),
});

export const CookieValueAssertionSchema = z.object({
  type: z.literal("cookie_value"),
  name: z.string().describe("Cookie name to check"),
  expected: z.string().describe("Expected cookie value"),
  match: z
    .enum(["exact", "contains"])
    .optional()
    .describe("Match mode (default: exact)"),
});

export const LocalStorageExistsAssertionSchema = z.object({
  type: z.literal("localstorage_exists"),
  key: z.string().describe("localStorage key to check"),
});

export const LocalStorageValueAssertionSchema = z.object({
  type: z.literal("localstorage_value"),
  key: z.string().describe("localStorage key to check"),
  expected: z.string().describe("Expected localStorage value"),
  match: z
    .enum(["exact", "contains"])
    .optional()
    .describe("Match mode (default: exact)"),
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
  body: string;
  duration: number; // ms
}

export interface AssertionResultData {
  type: string;
  expected?: string;
  actual?: string;
  passed: boolean;
  message?: string;
}
