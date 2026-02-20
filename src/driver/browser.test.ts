import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Step } from "../qa-plan/types.js";

// --- Playwright mocks ---

// Shared mock references, re-created per test in beforeEach
let mockPage: Record<string, ReturnType<typeof vi.fn>>;
let mockFrame: Record<string, ReturnType<typeof vi.fn>>;
let mockContext: Record<string, ReturnType<typeof vi.fn>>;
let mockBrowser: Record<string, ReturnType<typeof vi.fn>>;
let mockIframeElement: Record<string, ReturnType<typeof vi.fn>>;

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => mockBrowser),
  },
}));

function createFrameMock(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    click: vi.fn(),
    fill: vi.fn(),
    hover: vi.fn(),
    selectOption: vi.fn(),
    check: vi.fn(),
    uncheck: vi.fn(),
    press: vi.fn(),
    dblclick: vi.fn(),
    focus: vi.fn(),
    setInputFiles: vi.fn(),
    waitForSelector: vi.fn(),
    waitForURL: vi.fn(),
    $: vi.fn().mockResolvedValue(null),
    $$: vi.fn().mockResolvedValue([]),
    evaluate: vi.fn(),
    content: vi.fn().mockResolvedValue("<html></html>"),
    url: vi.fn().mockReturnValue("http://frame.example.com"),
    title: vi.fn().mockResolvedValue("Frame Title"),
  };
}

beforeEach(() => {
  mockFrame = createFrameMock();

  mockIframeElement = {
    contentFrame: vi.fn().mockResolvedValue(mockFrame),
  };

  mockPage = {
    ...createFrameMock(),
    // Page-specific methods (not on Frame)
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    setExtraHTTPHeaders: vi.fn(),
    url: vi.fn().mockReturnValue("http://page.example.com"),
    title: vi.fn().mockResolvedValue("Page Title"),
    content: vi.fn().mockResolvedValue("<html><body>page</body></html>"),
    close: vi.fn().mockResolvedValue(undefined),
  };
  // By default, page.$ finds the iframe element for "iframe#payment"
  mockPage.$.mockImplementation(async (selector: string) => {
    if (selector === "iframe#payment") return mockIframeElement;
    return null;
  });

  mockContext = {
    newPage: vi.fn(async () => mockPage),
    storageState: vi.fn(),
    cookies: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };

  mockBrowser = {
    newContext: vi.fn(async () => mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };
});

function makeStep(
  steps: Record<string, unknown>[],
  assertions?: Record<string, unknown>[]
): Step {
  return {
    id: "s1",
    step_key: "test_step",
    action: "browser",
    config: { steps } as Step["config"],
    assertions: assertions as Step["assertions"],
    sort_order: 0,
  };
}

// Dynamic import so vi.mock is applied before module load
async function createDriver() {
  const { BrowserDriver } = await import("./browser.js");
  return new BrowserDriver();
}

describe("BrowserDriver iframe support", () => {
  describe("switch_to_frame", () => {
    it("switches action context to iframe", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { click: ".card-input" },
      ]);

      await driver.execute(step, {});

      // click should be called on the frame, not the page
      expect(mockFrame.click).toHaveBeenCalledWith(".card-input");
      expect(mockPage.click).not.toHaveBeenCalled();

      await driver.close();
    });

    it("throws error when iframe element is not found", async () => {
      const driver = await createDriver();
      const step = makeStep([{ switch_to_frame: "iframe#nonexistent" }]);

      const result = await driver.execute(step, {});

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain("iframe not found: iframe#nonexistent");

      await driver.close();
    });

    it("throws error when element has no contentFrame", async () => {
      const noFrameElement = {
        contentFrame: vi.fn().mockResolvedValue(null),
      };
      mockPage.$.mockImplementation(async (selector: string) => {
        if (selector === "iframe#broken") return noFrameElement;
        return null;
      });

      const driver = await createDriver();
      const step = makeStep([{ switch_to_frame: "iframe#broken" }]);

      const result = await driver.execute(step, {});

      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain(
        "Element is not an iframe: iframe#broken"
      );

      await driver.close();
    });

    it("supports nested iframes by searching within active frame", async () => {
      const innerFrame = createFrameMock();
      const innerIframeElement = {
        contentFrame: vi.fn().mockResolvedValue(innerFrame),
      };
      // The outer frame finds the inner iframe
      mockFrame.$.mockImplementation(async (selector: string) => {
        if (selector === "iframe#inner") return innerIframeElement;
        return null;
      });

      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { switch_to_frame: "iframe#inner" },
        { click: ".deep-btn" },
      ]);

      await driver.execute(step, {});

      // click should be on the inner frame
      expect(innerFrame.click).toHaveBeenCalledWith(".deep-btn");
      expect(mockFrame.click).not.toHaveBeenCalled();
      expect(mockPage.click).not.toHaveBeenCalled();

      await driver.close();
    });
  });

  describe("switch_to_main_frame", () => {
    it("resets context back to the main page", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { click: ".frame-btn" },
        { switch_to_main_frame: true },
        { click: ".page-btn" },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.click).toHaveBeenCalledWith(".frame-btn");
      expect(mockPage.click).toHaveBeenCalledWith(".page-btn");

      await driver.close();
    });
  });

  describe("goto resets active frame", () => {
    it("resets to main page after goto", async () => {
      const driver = await createDriver();
      // First execute: switch to frame
      const step1 = makeStep([
        { switch_to_frame: "iframe#payment" },
        { click: ".frame-btn" },
      ]);
      await driver.execute(step1, {});

      // Note: execute() resets activeFrame at the start of each call,
      // but let's also verify goto within the same step resets it
      const step2 = makeStep([
        { switch_to_frame: "iframe#payment" },
        { goto: "http://newpage.example.com" },
        { click: ".page-btn" },
      ]);
      await driver.execute(step2, {});

      // After goto, click should go to the page
      expect(mockPage.click).toHaveBeenCalledWith(".page-btn");
      expect(mockPage.goto).toHaveBeenCalledWith("http://newpage.example.com", {
        waitUntil: "domcontentloaded",
      });

      await driver.close();
    });
  });

  describe("page-level actions ignore frame context", () => {
    it("screenshot always uses page", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { screenshot: "after_frame_switch" },
      ]);

      await driver.execute(step, {});

      expect(mockPage.screenshot).toHaveBeenCalledWith({ fullPage: true });

      await driver.close();
    });

    it("set_header always applies to page", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { set_header: { "X-Custom": "value" } },
      ]);

      await driver.execute(step, {});

      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith({
        "X-Custom": "value",
      });

      await driver.close();
    });
  });

  describe("frame-aware actions", () => {
    it("fill uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { type: { selector: "#card", text: "4242" } },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.fill).toHaveBeenCalledWith("#card", "4242");
      expect(mockPage.fill).not.toHaveBeenCalled();

      await driver.close();
    });

    it("hover uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { hover: ".tooltip" },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.hover).toHaveBeenCalledWith(".tooltip");

      await driver.close();
    });

    it("wait_for_selector uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { wait_for_selector: ".loaded" },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.waitForSelector).toHaveBeenCalledWith(".loaded");

      await driver.close();
    });

    it("select_option uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { select_option: { selector: "#country", value: "JP" } },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.selectOption).toHaveBeenCalledWith("#country", "JP");

      await driver.close();
    });

    it("check/uncheck uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { check: "#agree" },
        { uncheck: "#newsletter" },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.check).toHaveBeenCalledWith("#agree");
      expect(mockFrame.uncheck).toHaveBeenCalledWith("#newsletter");

      await driver.close();
    });

    it("press uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { press: { selector: "#card", key: "Enter" } },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.press).toHaveBeenCalledWith("#card", "Enter");

      await driver.close();
    });

    it("double_click uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { double_click: ".item" },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.dblclick).toHaveBeenCalledWith(".item");

      await driver.close();
    });

    it("focus uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { focus: "#card" },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.focus).toHaveBeenCalledWith("#card");

      await driver.close();
    });

    it("upload_file uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { upload_file: { selector: "#file", path: "/tmp/doc.pdf" } },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.setInputFiles).toHaveBeenCalledWith(
        "#file",
        "/tmp/doc.pdf"
      );

      await driver.close();
    });

    it("wait_for_url uses active frame", async () => {
      const driver = await createDriver();
      const step = makeStep([
        { switch_to_frame: "iframe#payment" },
        { wait_for_url: "success" },
      ]);

      await driver.execute(step, {});

      expect(mockFrame.waitForURL).toHaveBeenCalledWith("**/*success*");

      await driver.close();
    });
  });

  describe("assertions use active frame", () => {
    it("element_visible assertion uses frame context", async () => {
      const mockElement = { isVisible: vi.fn().mockResolvedValue(true) };
      mockFrame.$.mockResolvedValue(mockElement);

      const driver = await createDriver();
      const step = makeStep(
        [{ switch_to_frame: "iframe#payment" }],
        [{ type: "element_visible", selector: ".card-form" }]
      );

      const result = await driver.execute(step, {});

      expect(mockFrame.$).toHaveBeenCalledWith(".card-form");
      expect(result.assertionResults![0].passed).toBe(true);

      await driver.close();
    });

    it("element_text assertion uses frame context", async () => {
      const mockElement = {
        textContent: vi.fn().mockResolvedValue("Payment Complete"),
      };
      mockFrame.$.mockResolvedValue(mockElement);

      const driver = await createDriver();
      const step = makeStep(
        [{ switch_to_frame: "iframe#payment" }],
        [
          {
            type: "element_text",
            selector: ".status",
            contains: "Complete",
          },
        ]
      );

      const result = await driver.execute(step, {});

      expect(mockFrame.$).toHaveBeenCalledWith(".status");
      expect(result.assertionResults![0].passed).toBe(true);

      await driver.close();
    });

    it("url_contains assertion uses frame URL", async () => {
      mockFrame.url.mockReturnValue("http://payment.example.com/success");

      const driver = await createDriver();
      const step = makeStep(
        [{ switch_to_frame: "iframe#payment" }],
        [{ type: "url_contains", expected: "payment.example.com" }]
      );

      const result = await driver.execute(step, {});

      expect(result.assertionResults![0].passed).toBe(true);
      expect(result.assertionResults![0].actual).toBe(
        "http://payment.example.com/success"
      );

      await driver.close();
    });

    it("title assertion uses frame title", async () => {
      mockFrame.title.mockResolvedValue("Payment Form");

      const driver = await createDriver();
      const step = makeStep(
        [{ switch_to_frame: "iframe#payment" }],
        [{ type: "title", expected: "Payment Form" }]
      );

      const result = await driver.execute(step, {});

      expect(result.assertionResults![0].passed).toBe(true);

      await driver.close();
    });

    it("element_count assertion uses frame context", async () => {
      mockFrame.$$.mockResolvedValue([{}, {}, {}]);

      const driver = await createDriver();
      const step = makeStep(
        [{ switch_to_frame: "iframe#payment" }],
        [{ type: "element_count", selector: ".option", expected: 3 }]
      );

      const result = await driver.execute(step, {});

      expect(mockFrame.$$).toHaveBeenCalledWith(".option");
      expect(result.assertionResults![0].passed).toBe(true);

      await driver.close();
    });

    it("localstorage assertion uses frame context", async () => {
      mockFrame.evaluate.mockResolvedValue("stored-value");

      const driver = await createDriver();
      const step = makeStep(
        [{ switch_to_frame: "iframe#payment" }],
        [
          {
            type: "localstorage_value",
            key: "frame_token",
            expected: "stored-value",
          },
        ]
      );

      const result = await driver.execute(step, {});

      expect(mockFrame.evaluate).toHaveBeenCalled();
      expect(result.assertionResults![0].passed).toBe(true);

      await driver.close();
    });
  });

  describe("activeFrame reset between execute() calls", () => {
    it("resets to page at the start of each execute()", async () => {
      const driver = await createDriver();

      // First call: switch to frame
      const step1 = makeStep([
        { switch_to_frame: "iframe#payment" },
        { click: ".frame-btn" },
      ]);
      await driver.execute(step1, {});
      expect(mockFrame.click).toHaveBeenCalledWith(".frame-btn");

      // Second call: should start from page context
      mockFrame.click.mockClear();
      mockPage.click.mockClear();

      const step2 = makeStep([{ click: ".page-btn" }]);
      await driver.execute(step2, {});

      expect(mockPage.click).toHaveBeenCalledWith(".page-btn");
      expect(mockFrame.click).not.toHaveBeenCalled();

      await driver.close();
    });
  });
});
