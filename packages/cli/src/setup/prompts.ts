import { createInterface, Interface } from "node:readline";

let rl: Interface | null = null;

function getRL(): Interface {
  if (!rl) {
    rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
  }
  return rl;
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    getRL().question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function promptText(
  label: string,
  defaultValue?: string
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await ask(`${label}${suffix}: `);
  return answer || defaultValue || "";
}

export async function promptSelect<T extends { label: string }>(
  label: string,
  options: T[]
): Promise<{ index: number; value: T }> {
  console.error(`\n${label}`);
  for (let i = 0; i < options.length; i++) {
    console.error(`  ${i + 1}. ${options[i].label}`);
  }

  while (true) {
    const answer = await ask(`> `);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= options.length) {
      return { index: num - 1, value: options[num - 1] };
    }
    console.error(`  Please enter a number between 1 and ${options.length}`);
  }
}

export async function promptConfirm(
  label: string,
  defaultYes = true
): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]" : " [y/N]";
  const answer = await ask(`${label}${suffix}: `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

export function closePrompts(): void {
  rl?.close();
  rl = null;
}
