import type { Browser, BrowserContext, Page, Frame } from "playwright";
import type {
  Step,
  StepResult,
  Assertion,
  BrowserConfig,
  BrowserStep,
  BrowserArtifact,
  AssertionResultData,
} from "../qa-plan/types.js";
import type { ResolvedProxyConfig } from "../environment/types.js";

const DEFAULT_TIMEOUT_MS = 10000;

class NavigationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigationError";
  }
}

/** Serializable browser storage state (cookies + localStorage) */
export type BrowserStorageState = Awaited<
  ReturnType<BrowserContext["storageState"]>
>;

export class BrowserDriver {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private activeFrame: Page | Frame | null = null;
  private extraHeaders: Record<string, string> = {};
  private initialStorageState: BrowserStorageState | undefined;
  private proxyConfig: ResolvedProxyConfig | undefined;

  constructor(storageState?: BrowserStorageState, proxyConfig?: ResolvedProxyConfig) {
    this.initialStorageState = storageState;
    this.proxyConfig = proxyConfig;
  }

  async execute(
    step: Step,
    _variables: Record<string, string>
  ): Promise<StepResult> {
    const startedAt = new Date();
    const config = step.config as BrowserConfig;

    try {
      await this.ensureBrowser();

      // Reset active frame to main page at the start of each step
      this.activeFrame = this.page!;

      // Apply step-level timeout if specified
      const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
      this.page!.setDefaultTimeout(timeoutMs);
      this.page!.setDefaultNavigationTimeout(timeoutMs);

      const artifacts: BrowserArtifact[] = [];

      // Execute browser steps
      for (const browserStep of config.steps) {
        await this.executeBrowserStep(browserStep, artifacts);
      }

      // Evaluate assertions
      const assertionResults = await this.evaluateAssertions(step);
      const allPassed =
        assertionResults.length === 0 ||
        assertionResults.every((a) => a.passed);

      // Capture DOM snapshot
      if (this.page) {
        try {
          const html = await this.page.content();
          artifacts.push({
            name: `${step.step_key}_dom`,
            type: "dom_snapshot",
            contentType: "text/html",
            data: Buffer.from(html, "utf-8"),
          });
        } catch {
          // Non-critical
        }
      }

      return {
        stepKey: step.step_key,
        scenarioName: "",
        action: step.action,
        status: allPassed ? "passed" : "failed",
        assertionResults,
        browserArtifacts: artifacts.length > 0 ? artifacts : undefined,
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
        abortScenario: err instanceof NavigationError,
        startedAt,
        finishedAt: new Date(),
      };
    }
  }

  /** Get the current storage state (cookies + localStorage) for persistence across scenarios */
  async getStorageState(): Promise<BrowserStorageState | undefined> {
    if (!this.context) return undefined;
    return await this.context.storageState();
  }

  private async ensureBrowser(): Promise<void> {
    if (this.browser && this.page) return;

    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ headless: true });

    const contextOpts: Parameters<Browser["newContext"]>[0] = {};
    if (this.initialStorageState) {
      contextOpts.storageState = this.initialStorageState;
    }
    if (this.proxyConfig) {
      contextOpts.proxy = {
        server: this.proxyConfig.server,
        bypass: this.proxyConfig.bypass,
        username: this.proxyConfig.username,
        password: this.proxyConfig.password,
      };
    }
    this.context = await this.browser.newContext(contextOpts);
    this.page = await this.context.newPage();
    this.activeFrame = this.page;
  }

  private async executeBrowserStep(
    browserStep: BrowserStep,
    artifacts: BrowserArtifact[]
  ): Promise<void> {
    if (!this.page || !this.activeFrame) throw new Error("Browser page not initialized");

    const frame = this.activeFrame;

    if ("goto" in browserStep) {
      // goto always navigates the main page and resets active frame
      if (Object.keys(this.extraHeaders).length > 0) {
        await this.page.setExtraHTTPHeaders(this.extraHeaders);
      }
      try {
        await this.page.goto(browserStep.goto, { waitUntil: "domcontentloaded" });
      } catch (err) {
        throw new NavigationError(err instanceof Error ? err.message : String(err));
      }
      this.activeFrame = this.page;
    } else if ("switch_to_frame" in browserStep) {
      const iframeElement = await frame.$(browserStep.switch_to_frame);
      if (!iframeElement) {
        throw new Error(`iframe not found: ${browserStep.switch_to_frame}`);
      }
      const childFrame = await iframeElement.contentFrame();
      if (!childFrame) {
        throw new Error(`Element is not an iframe: ${browserStep.switch_to_frame}`);
      }
      this.activeFrame = childFrame;
    } else if ("switch_to_main_frame" in browserStep) {
      this.activeFrame = this.page;
    } else if ("wait_for_selector" in browserStep) {
      await frame.waitForSelector(browserStep.wait_for_selector);
    } else if ("click" in browserStep) {
      await frame.click(browserStep.click);
    } else if ("type" in browserStep) {
      const { selector, text } = browserStep.type;
      await frame.fill(selector, text);
    } else if ("screenshot" in browserStep) {
      // screenshot always captures the full page
      const screenshotBuffer = await this.page.screenshot({ fullPage: true });
      artifacts.push({
        name: browserStep.screenshot,
        type: "screenshot",
        contentType: "image/png",
        data: Buffer.from(screenshotBuffer),
      });
    } else if ("set_header" in browserStep) {
      // setExtraHTTPHeaders is page-level only
      Object.assign(this.extraHeaders, browserStep.set_header);
      await this.page.setExtraHTTPHeaders(this.extraHeaders);
    } else if ("hover" in browserStep) {
      await frame.hover(browserStep.hover);
    } else if ("select_option" in browserStep) {
      const { selector, value } = browserStep.select_option;
      await frame.selectOption(selector, value);
    } else if ("check" in browserStep) {
      await frame.check(browserStep.check);
    } else if ("uncheck" in browserStep) {
      await frame.uncheck(browserStep.uncheck);
    } else if ("press" in browserStep) {
      const { selector, key } = browserStep.press;
      await frame.press(selector, key);
    } else if ("wait_for_url" in browserStep) {
      await frame.waitForURL(`**/*${browserStep.wait_for_url}*`);
    } else if ("double_click" in browserStep) {
      await frame.dblclick(browserStep.double_click);
    } else if ("focus" in browserStep) {
      await frame.focus(browserStep.focus);
    } else if ("upload_file" in browserStep) {
      const { selector, path } = browserStep.upload_file;
      await frame.setInputFiles(selector, path);
    }
  }

  private async evaluateAssertions(step: Step): Promise<AssertionResultData[]> {
    if (!step.assertions || !this.page) return [];

    const results: AssertionResultData[] = [];
    for (const assertion of step.assertions) {
      let result: AssertionResultData;
      switch (assertion.type) {
        case "element_text": {
          result = await this.assertElementText(
            assertion.selector,
            assertion.contains
          );
          break;
        }
        case "element_visible": {
          result = await this.assertElementVisible(assertion.selector);
          break;
        }
        case "screenshot": {
          // Screenshot assertions are informational - they always pass
          // The actual screenshot is captured in executeBrowserStep
          result = {
            type: "screenshot",
            expected: assertion.name ?? "screenshot",
            actual: "captured",
            passed: true,
          };
          break;
        }
        case "url_contains": {
          const currentUrl = this.activeFrame!.url();
          const expected = assertion.expected;
          result = {
            type: "url_contains",
            expected,
            actual: currentUrl,
            passed: currentUrl.includes(expected),
            message: currentUrl.includes(expected)
              ? undefined
              : `URL "${currentUrl}" does not contain "${expected}"`,
          };
          break;
        }
        case "title": {
          const title = await this.activeFrame!.title();
          const expected = assertion.expected;
          result = {
            type: "title",
            expected,
            actual: title,
            passed: title === expected,
            message:
              title === expected
                ? undefined
                : `Expected title "${expected}", got "${title}"`,
          };
          break;
        }
        case "element_not_visible": {
          result = await this.assertElementNotVisible(assertion.selector);
          break;
        }
        case "element_count": {
          result = await this.assertElementCount(
            assertion.selector,
            assertion.expected
          );
          break;
        }
        case "element_attribute": {
          result = await this.assertElementAttribute(
            assertion.selector,
            assertion.attribute,
            assertion.expected
          );
          break;
        }
        case "cookie_exists": {
          result = await this.assertCookieExists(assertion.name);
          break;
        }
        case "cookie_value": {
          result = await this.assertCookieValue(
            assertion.name,
            assertion.expected,
            assertion.match
          );
          break;
        }
        case "localstorage_exists": {
          result = await this.assertLocalStorageExists(assertion.key);
          break;
        }
        case "localstorage_value": {
          result = await this.assertLocalStorageValue(
            assertion.key,
            assertion.expected,
            assertion.match
          );
          break;
        }
        default:
          result = {
            type: assertion.type,
            passed: false,
            message: `Unknown browser assertion type: ${assertion.type}`,
          };
      }
      if (assertion.description) {
        result.description = assertion.description;
      }
      results.push(result);
    }
    return results;
  }

  private async assertElementText(
    selector: string,
    contains?: string
  ): Promise<AssertionResultData> {
    try {
      const element = await this.activeFrame!.$(selector);
      if (!element) {
        return {
          type: "element_text",
          expected: contains
            ? `"${selector}" contains "${contains}"`
            : `"${selector}" exists`,
          actual: "element not found",
          passed: false,
          message: `Element not found: ${selector}`,
        };
      }

      const text = (await element.textContent()) ?? "";
      if (contains) {
        return {
          type: "element_text",
          expected: `contains "${contains}"`,
          actual: text,
          passed: text.includes(contains),
          message: text.includes(contains)
            ? undefined
            : `Text "${text}" does not contain "${contains}"`,
        };
      }

      // Just check that element has some text
      return {
        type: "element_text",
        expected: "has text",
        actual: text,
        passed: text.length > 0,
      };
    } catch (err) {
      return {
        type: "element_text",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async assertElementNotVisible(
    selector: string
  ): Promise<AssertionResultData> {
    try {
      const element = await this.activeFrame!.$(selector);
      const visible = element ? await element.isVisible() : false;
      return {
        type: "element_not_visible",
        expected: `"${selector}" is not visible`,
        actual: visible ? "visible" : "not visible",
        passed: !visible,
        message: !visible
          ? undefined
          : `Element "${selector}" is visible (expected not visible)`,
      };
    } catch (err) {
      return {
        type: "element_not_visible",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async assertElementCount(
    selector: string,
    expected: number
  ): Promise<AssertionResultData> {
    try {
      const elements = await this.activeFrame!.$$(selector);
      const count = elements.length;
      return {
        type: "element_count",
        expected: String(expected),
        actual: String(count),
        passed: count === expected,
        message:
          count === expected
            ? undefined
            : `Expected ${expected} elements matching "${selector}", found ${count}`,
      };
    } catch (err) {
      return {
        type: "element_count",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async assertElementAttribute(
    selector: string,
    attribute: string,
    expected: string
  ): Promise<AssertionResultData> {
    try {
      const element = await this.activeFrame!.$(selector);
      if (!element) {
        return {
          type: "element_attribute",
          expected: `"${selector}" [${attribute}] = "${expected}"`,
          actual: "element not found",
          passed: false,
          message: `Element not found: ${selector}`,
        };
      }
      const value = await element.getAttribute(attribute);
      return {
        type: "element_attribute",
        expected,
        actual: value ?? "(null)",
        passed: value === expected,
        message:
          value === expected
            ? undefined
            : `Expected attribute "${attribute}" to be "${expected}", got "${value ?? "(null)"}"`,
      };
    } catch (err) {
      return {
        type: "element_attribute",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async assertElementVisible(
    selector: string
  ): Promise<AssertionResultData> {
    try {
      const element = await this.activeFrame!.$(selector);
      const visible = element ? await element.isVisible() : false;
      return {
        type: "element_visible",
        expected: `"${selector}" is visible`,
        actual: visible ? "visible" : "not visible",
        passed: visible,
        message: visible
          ? undefined
          : `Element "${selector}" is not visible`,
      };
    } catch (err) {
      return {
        type: "element_visible",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async assertCookieExists(
    name: string
  ): Promise<AssertionResultData> {
    try {
      const cookies = await this.context!.cookies();
      const found = cookies.some((c) => c.name === name);
      return {
        type: "cookie_exists",
        expected: `cookie "${name}" exists`,
        actual: found ? "exists" : "not found",
        passed: found,
        message: found
          ? undefined
          : `Cookie "${name}" not found`,
      };
    } catch (err) {
      return {
        type: "cookie_exists",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async assertCookieValue(
    name: string,
    expected: string,
    match?: "exact" | "contains"
  ): Promise<AssertionResultData> {
    try {
      const cookies = await this.context!.cookies();
      const cookie = cookies.find((c) => c.name === name);
      if (!cookie) {
        return {
          type: "cookie_value",
          expected,
          actual: "cookie not found",
          passed: false,
          message: `Cookie "${name}" not found`,
        };
      }
      const mode = match ?? "exact";
      const passed =
        mode === "contains"
          ? cookie.value.includes(expected)
          : cookie.value === expected;
      return {
        type: "cookie_value",
        expected: mode === "contains" ? `contains "${expected}"` : expected,
        actual: cookie.value,
        passed,
        message: passed
          ? undefined
          : `Cookie "${name}" value "${cookie.value}" does not ${mode === "contains" ? "contain" : "equal"} "${expected}"`,
      };
    } catch (err) {
      return {
        type: "cookie_value",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async assertLocalStorageExists(
    key: string
  ): Promise<AssertionResultData> {
    try {
      const value = await this.activeFrame!.evaluate(
        // @ts-expect-error - localStorage exists in browser context
        (k) => localStorage.getItem(k),
        key
      );
      const found = value !== null;
      return {
        type: "localstorage_exists",
        expected: `localStorage "${key}" exists`,
        actual: found ? "exists" : "not found",
        passed: found,
        message: found
          ? undefined
          : `localStorage key "${key}" not found`,
      };
    } catch (err) {
      return {
        type: "localstorage_exists",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async assertLocalStorageValue(
    key: string,
    expected: string,
    match?: "exact" | "contains"
  ): Promise<AssertionResultData> {
    try {
      const value = await this.activeFrame!.evaluate(
        // @ts-expect-error - localStorage exists in browser context
        (k) => localStorage.getItem(k),
        key
      );
      if (value === null) {
        return {
          type: "localstorage_value",
          expected,
          actual: "key not found",
          passed: false,
          message: `localStorage key "${key}" not found`,
        };
      }
      const mode = match ?? "exact";
      const passed =
        mode === "contains"
          ? value.includes(expected)
          : value === expected;
      return {
        type: "localstorage_value",
        expected: mode === "contains" ? `contains "${expected}"` : expected,
        actual: value,
        passed,
        message: passed
          ? undefined
          : `localStorage "${key}" value "${value}" does not ${mode === "contains" ? "contain" : "equal"} "${expected}"`,
      };
    } catch (err) {
      return {
        type: "localstorage_value",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Execute a single browser step for interactive exploration.
   * Unlike execute(), this does NOT reset activeFrame between calls,
   * preserving frame context across multiple exploration actions.
   */
  async executeSingleBrowserStep(
    browserStep: BrowserStep,
    timeoutMs?: number,
  ): Promise<void> {
    await this.ensureBrowser();

    if (timeoutMs) {
      this.page!.setDefaultTimeout(timeoutMs);
      this.page!.setDefaultNavigationTimeout(timeoutMs);
    }

    const artifacts: BrowserArtifact[] = [];
    await this.executeBrowserStep(browserStep, artifacts);
  }

  /**
   * Get the current page state (screenshot, DOM, URL, title).
   * Returns null if the browser is not initialized or state cannot be captured.
   */
  async getPageState(): Promise<{
    screenshot: Buffer;
    dom: string;
    url: string;
    title: string;
  } | null> {
    if (!this.page) return null;
    try {
      const screenshot = Buffer.from(await this.page.screenshot({ fullPage: true }));
      const dom = await this.page.content();
      const url = this.page.url();
      const title = await this.page.title();
      return { screenshot, dom, url, title };
    } catch {
      return null;
    }
  }

  /**
   * Evaluate a single browser assertion for interactive exploration.
   */
  async evaluateSingleAssertion(assertion: Assertion): Promise<AssertionResultData> {
    await this.ensureBrowser();
    const syntheticStep: Step = {
      id: "explore",
      step_key: "explore",
      action: "browser",
      config: { steps: [] } as BrowserConfig,
      assertions: [assertion],
      sort_order: 0,
    };
    const results = await this.evaluateAssertions(syntheticStep);
    return results[0] ?? { type: assertion.type, passed: false, message: "No result" };
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.activeFrame = null;
    this.extraHeaders = {};
  }
}
