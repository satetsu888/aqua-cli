import { recordBrowserActions } from "../recorder/recorder.js";

export async function runRecord(url?: string): Promise<void> {
  console.error("Recording browser actions...");
  console.error("A browser window will open. Perform your actions, then close the browser.");
  console.error("");

  try {
    const result = await recordBrowserActions({ url });

    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(`Warning: ${warning}`);
      }
      console.error("");
    }

    if (result.steps.length === 0) {
      console.error("No actions were recorded.");
      process.exit(0);
    }

    console.error(`Recorded ${result.steps.length} step(s).`);

    if (result.inputVariables.length > 0) {
      console.error("");
      console.error(
        "Input values have been replaced with template variables:"
      );
      for (const v of result.inputVariables) {
        console.error(`  {{${v}}}`);
      }
      console.error(
        "Set actual values in your environment or pass as variables when executing."
      );
    }

    // Output BrowserStep[] as JSON to stdout
    console.log(JSON.stringify(result.steps, null, 2));
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
