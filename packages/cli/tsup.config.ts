import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig([
  // CLI entry point (with shebang)
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node18",
    outDir: "dist",
    clean: true,
    splitting: false,
    sourcemap: false,
    dts: false,
    define: {
      __CLI_VERSION__: JSON.stringify(pkg.version),
    },
    banner: {
      js: "#!/usr/bin/env node",
    },
    external: [
      "@modelcontextprotocol/sdk",
      "commander",
      "playwright",
      "undici",
      "zod",
    ],
  },
  // Plugin interface + utils (library exports, no shebang)
  {
    entry: [
      "src/plugin/interface.ts",
      "src/plugin/utils.ts",
    ],
    format: ["esm"],
    target: "node18",
    outDir: "dist/plugin",
    clean: false,
    splitting: false,
    sourcemap: false,
    dts: true,
    external: [
      "zod",
    ],
  },
]);
