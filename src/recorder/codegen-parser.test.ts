import { describe, it, expect } from "vitest";
import { parseCodegenOutput } from "./codegen-parser.js";

describe("parseCodegenOutput", () => {
  describe("goto", () => {
    it("parses page.goto", () => {
      const code = `await page.goto('https://example.com/login');`;
      const { steps, warnings } = parseCodegenOutput(code);
      expect(steps).toEqual([{ goto: "https://example.com/login" }]);
      expect(warnings).toHaveLength(0);
    });

    it("parses goto with double quotes", () => {
      const code = `await page.goto("https://example.com/");`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ goto: "https://example.com/" }]);
    });
  });

  describe("click actions", () => {
    it("parses getByRole click", () => {
      const code = `await page.getByRole('button', { name: 'Submit' }).click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: `role=button[name="Submit"]` }]);
    });

    it("parses getByRole with exact: true", () => {
      const code = `await page.getByRole('link', { name: 'Home', exact: true }).click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: `role=link[name="Home"s]` }]);
    });

    it("parses getByRole without name", () => {
      const code = `await page.getByRole('navigation').click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: "role=navigation" }]);
    });

    it("parses getByText click", () => {
      const code = `await page.getByText('Sign up').click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: "text=Sign up" }]);
    });

    it("parses getByText with exact: true", () => {
      const code = `await page.getByText('OK', { exact: true }).click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: `text="OK"` }]);
    });

    it("parses getByTestId click", () => {
      const code = `await page.getByTestId('submit-btn').click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: `[data-testid="submit-btn"]` }]);
    });

    it("parses getByPlaceholder click", () => {
      const code = `await page.getByPlaceholder('Enter email').click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: `[placeholder="Enter email"]` }]);
    });

    it("parses getByAltText click", () => {
      const code = `await page.getByAltText('Logo').click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: `[alt="Logo"]` }]);
    });

    it("parses getByTitle click", () => {
      const code = `await page.getByTitle('Close dialog').click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: `[title="Close dialog"]` }]);
    });

    it("parses locator CSS click", () => {
      const code = `await page.locator('#submit-button').click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: "#submit-button" }]);
    });

    it("parses locator with complex CSS", () => {
      const code = `await page.locator('div.container > button.primary').click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ click: "div.container > button.primary" }]);
    });
  });

  describe("double click", () => {
    it("parses dblclick", () => {
      const code = `await page.getByText('item').dblclick();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ double_click: "text=item" }]);
    });
  });

  describe("fill (type) — input masking", () => {
    it("masks fill value with variable derived from label", () => {
      const code = `await page.getByLabel('Email').fill('user@example.com');`;
      const { steps, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { type: { selector: `internal:label="Email"i`, text: "{{email}}" } },
      ]);
      expect(inputVariables).toEqual(["email"]);
    });

    it("masks fill value with variable derived from label (exact)", () => {
      const code = `await page.getByLabel('Name', { exact: true }).fill('John');`;
      const { steps, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { type: { selector: `internal:label="Name"s`, text: "{{name}}" } },
      ]);
      expect(inputVariables).toEqual(["name"]);
    });

    it("masks fill value with variable derived from placeholder", () => {
      const code = `await page.getByPlaceholder('Search...').fill('hello');`;
      const { steps, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { type: { selector: `[placeholder="Search..."]`, text: "{{search}}" } },
      ]);
      expect(inputVariables).toEqual(["search"]);
    });

    it("masks fill value with variable derived from id", () => {
      const code = `await page.locator('#email-input').fill('test@test.com');`;
      const { steps, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { type: { selector: "#email-input", text: "{{email_input}}" } },
      ]);
      expect(inputVariables).toEqual(["email_input"]);
    });

    it("masks fill value with variable derived from role name", () => {
      const code = `await page.getByRole('textbox', { name: 'Username' }).fill('admin');`;
      const { steps, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        {
          type: {
            selector: `role=textbox[name="Username"]`,
            text: "{{username}}",
          },
        },
      ]);
      expect(inputVariables).toEqual(["username"]);
    });

    it("masks fill value with variable derived from testid", () => {
      const code = `await page.getByTestId('login-password').fill('secret');`;
      const { steps, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        {
          type: {
            selector: `[data-testid="login-password"]`,
            text: "{{login_password}}",
          },
        },
      ]);
      expect(inputVariables).toEqual(["login_password"]);
    });

    it("deduplicates variable names for same-label fields", () => {
      const code = [
        `await page.getByLabel('Password').fill('secret');`,
        `await page.getByLabel('Password').fill('secret-again');`,
      ].join("\n");
      const { steps, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        {
          type: {
            selector: `internal:label="Password"i`,
            text: "{{password}}",
          },
        },
        {
          type: {
            selector: `internal:label="Password"i`,
            text: "{{password_2}}",
          },
        },
      ]);
      expect(inputVariables).toEqual(["password", "password_2"]);
    });

    it("uses fallback name for unrecognizable selectors", () => {
      const code = `await page.locator('div.form > input').fill('value');`;
      const { steps, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        {
          type: {
            selector: "div.form > input",
            text: "{{input}}",
          },
        },
      ]);
      expect(inputVariables).toEqual(["input"]);
    });
  });

  describe("hover", () => {
    it("parses hover", () => {
      const code = `await page.getByRole('menuitem', { name: 'Settings' }).hover();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ hover: `role=menuitem[name="Settings"]` }]);
    });
  });

  describe("focus", () => {
    it("parses focus", () => {
      const code = `await page.locator('#search').focus();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ focus: "#search" }]);
    });
  });

  describe("check/uncheck", () => {
    it("parses check", () => {
      const code = `await page.getByLabel('Agree to terms').check();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ check: `internal:label="Agree to terms"i` }]);
    });

    it("parses uncheck", () => {
      const code = `await page.getByLabel('Subscribe').uncheck();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([{ uncheck: `internal:label="Subscribe"i` }]);
    });
  });

  describe("selectOption", () => {
    it("parses selectOption", () => {
      const code = `await page.getByLabel('Country').selectOption('JP');`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { select_option: { selector: `internal:label="Country"i`, value: "JP" } },
      ]);
    });
  });

  describe("press", () => {
    it("parses press", () => {
      const code = `await page.getByLabel('Search').press('Enter');`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { press: { selector: `internal:label="Search"i`, key: "Enter" } },
      ]);
    });
  });

  describe("setInputFiles (upload_file)", () => {
    it("parses setInputFiles", () => {
      const code = `await page.getByLabel('Upload').setInputFiles('/tmp/test.png');`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { upload_file: { selector: `internal:label="Upload"i`, path: "/tmp/test.png" } },
      ]);
    });
  });

  describe("chained locators", () => {
    it("parses chained getByRole locators", () => {
      const code = `await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { click: `role=dialog >> role=button[name="OK"]` },
      ]);
    });

    it("parses locator + getByRole chain", () => {
      const code = `await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();`;
      const { steps } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { click: `.modal >> role=button[name="Cancel"]` },
      ]);
    });
  });

  describe("full codegen output", () => {
    it("parses a complete codegen output with boilerplate", () => {
      const code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://example.com/login');
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('secret123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByText('Dashboard').click();

  // ---------------------
  await context.close();
  await browser.close();
})();`;

      const { steps, warnings, inputVariables } = parseCodegenOutput(code);
      expect(steps).toEqual([
        { goto: "https://example.com/login" },
        { type: { selector: `internal:label="Email"i`, text: "{{email}}" } },
        { type: { selector: `internal:label="Password"i`, text: "{{password}}" } },
        { click: `role=button[name="Log in"]` },
        { click: "text=Dashboard" },
      ]);
      expect(warnings).toHaveLength(0);
      expect(inputVariables).toEqual(["email", "password"]);
    });
  });

  describe("skips and warnings", () => {
    it("skips non-action lines", () => {
      const code = `
const { chromium } = require('playwright');
// some comment
const browser = await chromium.launch();
`;
      const { steps, warnings } = parseCodegenOutput(code);
      expect(steps).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });

    it("warns on unparseable page actions", () => {
      const code = `await page.waitForTimeout(1000);`;
      const { steps, warnings } = parseCodegenOutput(code);
      expect(steps).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("waitForTimeout");
    });

    it("returns empty result for empty input", () => {
      const { steps, warnings } = parseCodegenOutput("");
      expect(steps).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });
  });
});
