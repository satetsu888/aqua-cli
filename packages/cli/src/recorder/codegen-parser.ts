import type { BrowserStep } from "../qa-plan/types.js";

export interface ParseResult {
  steps: BrowserStep[];
  warnings: string[];
  inputVariables: string[];
}

/**
 * Parse Playwright codegen JavaScript output into BrowserStep[].
 *
 * Codegen (--target=javascript) outputs one action per line:
 *   await page.goto('https://example.com/');
 *   await page.getByRole('button', { name: 'Submit' }).click();
 *   await page.getByLabel('Email').fill('user@example.com');
 */
export function parseCodegenOutput(code: string): ParseResult {
  const rawSteps: BrowserStep[] = [];
  const warnings: string[] = [];

  for (const rawLine of code.split("\n")) {
    const line = rawLine.trim();

    // Skip non-action lines (imports, boilerplate, empty, comments)
    if (!line.startsWith("await page.")) continue;

    const step = parseLine(line);
    if (step) {
      rawSteps.push(step);
    } else {
      warnings.push(`Skipped unparseable line: ${line}`);
    }
  }

  const { steps, inputVariables } = maskFillValues(rawSteps);

  return { steps, warnings, inputVariables };
}

function parseLine(line: string): BrowserStep | null {
  // goto
  const gotoMatch = line.match(/^await page\.goto\((['"`])(.+?)\1\)/);
  if (gotoMatch) {
    return { goto: gotoMatch[2] };
  }

  // Actions with a locator: await page.<locator>.<action>(...);
  // First, try to extract locator and action parts
  const locatorAndAction = parseLocatorAction(line);
  if (!locatorAndAction) return null;

  const { selector, action, actionArg } = locatorAndAction;

  switch (action) {
    case "click":
      return { click: selector };
    case "dblclick":
      return { double_click: selector };
    case "hover":
      return { hover: selector };
    case "focus":
      return { focus: selector };
    case "check":
      return { check: selector };
    case "uncheck":
      return { uncheck: selector };
    case "fill":
      if (actionArg !== undefined) {
        return { type: { selector, text: actionArg } };
      }
      return null;
    case "selectOption":
      if (actionArg !== undefined) {
        return { select_option: { selector, value: actionArg } };
      }
      return null;
    case "press":
      if (actionArg !== undefined) {
        return { press: { selector, key: actionArg } };
      }
      return null;
    case "setInputFiles":
      if (actionArg !== undefined) {
        return { upload_file: { selector, path: actionArg } };
      }
      return null;
    default:
      return null;
  }
}

interface LocatorAction {
  selector: string;
  action: string;
  actionArg?: string;
}

function parseLocatorAction(line: string): LocatorAction | null {
  // Remove 'await page.' prefix and trailing ';'
  let rest = line.replace(/^await page\./, "").replace(/;$/, "");

  // Split into locator chain and final action
  // The final action is after the last ').'
  // e.g., "getByRole('button', { name: 'X' }).click()"
  // We need to find the action method at the end

  // Strategy: find the action method by matching known actions at the end
  const actionPatterns: Array<{ name: string; regex: RegExp }> = [
    { name: "click", regex: /\.click\(\)$/ },
    { name: "dblclick", regex: /\.dblclick\(\)$/ },
    { name: "hover", regex: /\.hover\(\)$/ },
    { name: "focus", regex: /\.focus\(\)$/ },
    { name: "check", regex: /\.check\(\)$/ },
    { name: "uncheck", regex: /\.uncheck\(\)$/ },
    { name: "fill", regex: /\.fill\((['"`])(.+?)\1\)$/ },
    { name: "selectOption", regex: /\.selectOption\((['"`])(.+?)\1\)$/ },
    { name: "press", regex: /\.press\((['"`])(.+?)\1\)$/ },
    { name: "setInputFiles", regex: /\.setInputFiles\((['"`])(.+?)\1\)$/ },
  ];

  for (const { name, regex } of actionPatterns) {
    const actionMatch = rest.match(regex);
    if (actionMatch) {
      const locatorPart = rest.slice(0, actionMatch.index!);
      const selector = parseLocator(locatorPart);
      if (!selector) return null;

      // Extract action argument (for fill, press, etc.)
      const actionArg = actionMatch[2]; // capture group 2 is the arg value
      return { selector, action: name, actionArg };
    }
  }

  return null;
}

/**
 * Convert a Playwright locator expression to an aqua selector string.
 *
 * Supports chained locators (e.g., getByRole('dialog').getByRole('button', { name: 'OK' }))
 * by converting to Playwright's >> chaining syntax.
 */
function parseLocator(locatorExpr: string): string | null {
  // Handle chained locators: split on '.' that precedes a getBy/locator call
  const segments = splitLocatorChain(locatorExpr);
  if (segments.length === 0) return null;

  const selectors = segments.map(parseSingleLocator).filter(Boolean) as string[];
  if (selectors.length !== segments.length) return null;

  return selectors.join(" >> ");
}

function splitLocatorChain(expr: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "." && depth === 0 && i > start) {
      // Check if what follows is a locator method
      const rest = expr.slice(i + 1);
      if (/^(?:getBy\w+|locator|first|last|nth|filter)\(/.test(rest)) {
        segments.push(expr.slice(start, i));
        start = i + 1;
      }
    }
  }

  if (start < expr.length) {
    segments.push(expr.slice(start));
  }

  return segments;
}

function parseSingleLocator(locator: string): string | null {
  // getByRole('button', { name: 'X' })
  const roleMatch = locator.match(
    /^getByRole\((['"`])(\w+)\1(?:\s*,\s*\{([^}]*)\})?\)/
  );
  if (roleMatch) {
    const role = roleMatch[2];
    const optsStr = roleMatch[3];
    let nameStr = "";
    if (optsStr) {
      const nameMatch = optsStr.match(/name:\s*(['"`])(.+?)\1/);
      if (nameMatch) {
        const exact = /exact:\s*true/.test(optsStr);
        nameStr = exact
          ? `[name="${nameMatch[2]}"s]`
          : `[name="${nameMatch[2]}"]`;
      }
    }
    return `role=${role}${nameStr}`;
  }

  // getByText('X', { exact: true })
  const textMatch = locator.match(
    /^getByText\((['"`])(.+?)\1(?:\s*,\s*\{([^}]*)\})?\)/
  );
  if (textMatch) {
    const text = textMatch[2];
    const optsStr = textMatch[3];
    const exact = optsStr ? /exact:\s*true/.test(optsStr) : false;
    return exact ? `text="${text}"` : `text=${text}`;
  }

  // getByLabel('X')
  const labelMatch = locator.match(
    /^getByLabel\((['"`])(.+?)\1(?:\s*,\s*\{([^}]*)\})?\)/
  );
  if (labelMatch) {
    const label = labelMatch[2];
    const optsStr = labelMatch[3];
    const exact = optsStr ? /exact:\s*true/.test(optsStr) : false;
    return exact ? `internal:label="${label}"s` : `internal:label="${label}"i`;
  }

  // getByPlaceholder('X')
  const placeholderMatch = locator.match(
    /^getByPlaceholder\((['"`])(.+?)\1/
  );
  if (placeholderMatch) {
    return `[placeholder="${placeholderMatch[2]}"]`;
  }

  // getByTestId('X')
  const testIdMatch = locator.match(/^getByTestId\((['"`])(.+?)\1/);
  if (testIdMatch) {
    return `[data-testid="${testIdMatch[2]}"]`;
  }

  // getByAltText('X')
  const altMatch = locator.match(/^getByAltText\((['"`])(.+?)\1/);
  if (altMatch) {
    return `[alt="${altMatch[2]}"]`;
  }

  // getByTitle('X')
  const titleMatch = locator.match(/^getByTitle\((['"`])(.+?)\1/);
  if (titleMatch) {
    return `[title="${titleMatch[2]}"]`;
  }

  // locator('selector')
  const locatorMatch = locator.match(/^locator\((['"`])(.+?)\1\)/);
  if (locatorMatch) {
    return locatorMatch[2];
  }

  // nth(n) - used in chaining
  const nthMatch = locator.match(/^nth\((\d+)\)/);
  if (nthMatch) {
    return `nth=${nthMatch[1]}`;
  }

  // first()
  if (locator === "first()") {
    return "nth=0";
  }

  // last()
  if (locator === "last()") {
    return "nth=-1";
  }

  return null;
}

/**
 * Replace fill action values with auto-generated {{variable_name}} templates.
 * Variable names are derived from the selector (label, placeholder, id, etc.).
 */
function maskFillValues(rawSteps: BrowserStep[]): {
  steps: BrowserStep[];
  inputVariables: string[];
} {
  const steps: BrowserStep[] = [];
  const inputVariables: string[] = [];
  const usedNames = new Map<string, number>();

  for (const step of rawSteps) {
    if ("type" in step && step.type) {
      const { selector } = step.type;
      const varName = deriveUniqueVarName(selector, usedNames);
      inputVariables.push(varName);
      steps.push({ type: { selector, text: `{{${varName}}}` } });
    } else {
      steps.push(step);
    }
  }

  return { steps, inputVariables };
}

function deriveUniqueVarName(
  selector: string,
  usedNames: Map<string, number>
): string {
  const base = deriveVariableNameFromSelector(selector);
  const count = usedNames.get(base) ?? 0;
  usedNames.set(base, count + 1);
  if (count === 0) return base;
  return `${base}_${count + 1}`;
}

function deriveVariableNameFromSelector(selector: string): string {
  // For chained selectors (a >> b >> c), use the last segment
  const segments = selector.split(" >> ");
  const seg = segments[segments.length - 1];

  // internal:label="Email"i → "email"
  const labelMatch = seg.match(/internal:label="([^"]+)"/);
  if (labelMatch) return toSnakeCase(labelMatch[1]);

  // role=...[name="Email"] → "email"
  const roleNameMatch = seg.match(/\[name="([^"]+)"/);
  if (roleNameMatch) return toSnakeCase(roleNameMatch[1]);

  // [placeholder="Enter email"] → "enter_email"
  const placeholderMatch = seg.match(/\[placeholder="([^"]+)"/);
  if (placeholderMatch) return toSnakeCase(placeholderMatch[1]);

  // [data-testid="login-email"] → "login_email"
  const testIdMatch = seg.match(/\[data-testid="([^"]+)"/);
  if (testIdMatch) return toSnakeCase(testIdMatch[1]);

  // [alt="..."], [title="..."], [name="..."] attribute selectors
  const attrMatch = seg.match(/\[(?:alt|title|name)="([^"]+)"/);
  if (attrMatch) return toSnakeCase(attrMatch[1]);

  // #some-id → "some_id"
  const idMatch = seg.match(/^#([\w-]+)/);
  if (idMatch) return toSnakeCase(idMatch[1]);

  // Fallback
  return "input";
}

function toSnakeCase(str: string): string {
  const result = str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
  return result || "input";
}
