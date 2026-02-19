import type { Step, StepResult } from "../qa-plan/types.js";

/**
 * depends_on に基づくトポロジカルソート。
 * 同一シナリオ内のステップのみソート対象。
 */
export function resolveStepOrder(steps: Step[]): Step[] {
  const stepMap = new Map(steps.map((s) => [s.step_key, s]));
  const visited = new Set<string>();
  const ordered: Step[] = [];

  const visit = (step: Step) => {
    if (visited.has(step.step_key)) return;
    visited.add(step.step_key);

    for (const depKey of step.depends_on ?? []) {
      const dep = stepMap.get(depKey);
      if (dep) visit(dep);
    }

    ordered.push(step);
  };

  for (const step of steps) {
    visit(step);
  }

  return ordered;
}

/**
 * ステップの depends_on がすべて passed であるかチェック。
 * completedSteps は他シナリオのステップも含む（シナリオ横断の依存解決）。
 */
export function checkStepDependencies(
  step: Step,
  completedSteps: Map<string, StepResult>
): boolean {
  if (!step.depends_on) return true;
  return step.depends_on.every((depKey) => {
    const depResult = completedSteps.get(depKey);
    return depResult && depResult.status === "passed";
  });
}

/**
 * Playwright とブラウザバイナリのインストール確認。
 */
export async function checkBrowserDependencies(): Promise<void> {
  let pw;
  try {
    pw = await import("playwright");
  } catch {
    throw new Error(
      "Playwright is not installed. This plan includes browser steps that require Playwright.\n" +
      "Install it with: npx playwright install"
    );
  }

  const { existsSync } = await import("node:fs");
  const execPath = pw.chromium.executablePath();
  if (!existsSync(execPath)) {
    throw new Error(
      "Playwright browser binaries are not installed. This plan includes browser steps that require Chromium.\n" +
      "Install them with: npx playwright install chromium"
    );
  }
}
