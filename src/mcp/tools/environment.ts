import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listEnvironments,
  validateEnvironment,
  saveEnvironment,
  secretEntrySchema,
  proxyConfigSchema,
} from "../../environment/index.js";

export function registerEnvironmentTools(server: McpServer) {
  server.tool(
    "list_environments",
    "List available environment configurations from .aqua/environments/",
    {},
    async () => {
      const environments = await listEnvironments();

      if (environments.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No environments found. Use `create_environment` to create one.",
            },
          ],
        };
      }

      const lines = [
        `# Available Environments`,
        ``,
      ];

      for (const env of environments) {
        lines.push(`## ${env.name}`);
        if (env.notes) {
          lines.push(env.notes);
        } else {
          lines.push(`(no notes)`);
        }
        lines.push(``);
      }

      lines.push(
        `Use \`execute_qa_plan\` with \`env_name\` parameter to select an environment.`
      );

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "validate_environment",
    "Validate an environment configuration file. Checks schema, secret resolution, and reports issues.",
    {
      env_name: z
        .string()
        .describe("Environment name to validate (matches .aqua/environments/{env_name}.json)"),
    },
    async ({ env_name }) => {
      const result = await validateEnvironment(env_name);

      const lines: string[] = [
        `# Environment Validation: ${env_name}`,
        ``,
        `**File:** ${result.filePath}`,
        `**Valid:** ${result.valid ? "Yes" : "No"}`,
      ];

      if (result.variableKeys && result.variableKeys.length > 0) {
        lines.push(``, `## Variables`);
        for (const key of result.variableKeys) {
          lines.push(`- ${key}`);
        }
      }

      if (result.secretKeys && result.secretKeys.length > 0) {
        lines.push(``, `## Secrets`);
        for (const key of result.secretKeys) {
          lines.push(`- ${key}`);
        }
      }

      if (result.issues.length > 0) {
        lines.push(``, `## Issues`);
        for (const issue of result.issues) {
          const icon = issue.severity === "error" ? "[ERROR]" : "[WARN]";
          lines.push(`- ${icon} ${issue.message}`);
        }
      } else {
        lines.push(``, `No issues found.`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "create_environment",
    `Create or overwrite an environment configuration file at .aqua/environments/{env_name}.json.

Variables are used as {{variable_name}} templates in QA plan steps. Use api_base_url for API endpoints and web_base_url for browser URLs.
Secrets are resolved at execution time and masked before sending to server.`,
    {
      env_name: z
        .string()
        .describe("Environment name (e.g. staging, production). Saved as .aqua/environments/{env_name}.json"),
      notes: z
        .string()
        .optional()
        .describe("Free-form notes about this environment (Markdown). Use for prerequisites, constraints, test accounts, auth instructions, etc. Shown in list_environments output so AI agents can factor in environment-specific constraints when designing QA plans."),
      variables: z
        .record(z.string())
        .optional()
        .describe("Plain variables for template expansion. Example: { api_base_url: \"https://api.staging.example.com\", web_base_url: \"https://staging.example.com\" }"),
      secrets: z
        .record(secretEntrySchema)
        .optional()
        .describe("Secrets with resolution type. literal: use value directly, env: read from environment variable, op: read from 1Password CLI at execution time (value is a secret reference URI). Example: { api_key: { type: \"literal\", value: \"key-123\" }, auth_token: { type: \"env\", value: \"STAGING_AUTH_TOKEN\" }, db_password: { type: \"op\", value: \"op://vault/item/password\" } }"),
      proxy: proxyConfigSchema
        .optional()
        .describe("Proxy configuration for HTTP requests and browser access. server: proxy URL (e.g. \"http://proxy:3128\"), bypass: comma-separated domains to bypass, username/password: optional proxy auth credentials using SecretEntry format."),
    },
    async ({ env_name, notes, variables, secrets, proxy }) => {
      try {
        const envFile = {
          ...(notes ? { notes } : {}),
          ...(variables ? { variables } : {}),
          ...(secrets ? { secrets } : {}),
          ...(proxy ? { proxy } : {}),
        };
        const filePath = await saveEnvironment(env_name, envFile);
        return {
          content: [
            {
              type: "text" as const,
              text: `Environment "${env_name}" created at ${filePath}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
