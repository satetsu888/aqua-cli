import { spawn } from "node:child_process";
import { checkBrowserDependencies } from "../driver/step-utils.js";
import { parseCodegenOutput, type ParseResult } from "./codegen-parser.js";
import type { BrowserStep } from "../qa-plan/types.js";

export interface RecordOptions {
  url?: string;
}

export interface RecordResult {
  steps: BrowserStep[];
  rawCode: string;
  warnings: string[];
  inputVariables: string[];
}

/**
 * Launch Playwright codegen as a subprocess and record user browser actions.
 * The user operates the browser; when they close it, the generated JavaScript
 * is parsed into BrowserStep[].
 */
export async function recordBrowserActions(
  opts: RecordOptions
): Promise<RecordResult> {
  await checkBrowserDependencies();

  const rawCode = await runCodegen(opts.url);
  const parsed: ParseResult = parseCodegenOutput(rawCode);

  return {
    steps: parsed.steps,
    rawCode,
    warnings: parsed.warnings,
    inputVariables: parsed.inputVariables,
  };
}

function runCodegen(url?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["playwright", "codegen", "--target=javascript"];
    if (url) {
      args.push(url);
    }

    const child = spawn("npx", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      reject(
        new Error(`Failed to start playwright codegen: ${err.message}`)
      );
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      if (code !== 0 && !stdout) {
        reject(
          new Error(
            `playwright codegen exited with code ${code}${stderr ? `\n${stderr}` : ""}`
          )
        );
        return;
      }

      resolve(stdout);
    });
  });
}
