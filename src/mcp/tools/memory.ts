import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AquaClient } from "../../api/client.js";

const MEMORY_TEMPLATE = `# Project Memory

This is a TEMPLATE for project memory. No knowledge has been recorded yet.
As you create and execute QA plans, record useful insights here using save_project_memory.
The sections below are suggestions — add what you learn, remove what's not relevant.

## App Architecture

<!-- Describe the overall architecture of the target application. Example:
- Frontend: React SPA, routing defined in src/routes/
- Backend: Express API, endpoints in src/api/routes/
- Auth: session cookie based
-->

(Replace this with the actual app architecture)

## Source Code Pointers

<!-- List the key source files that define routing, API endpoints, and auth.
These pointers help you quickly find the right code without broad exploration. Example:
- Frontend routing: \`src/routes/index.tsx\`
- API routing: \`src/api/routes/\` directory
- Auth middleware: \`src/api/middleware/auth.ts\`
-->

(Replace this with actual file paths from the project)

## Authentication Flow

<!-- Describe the step-by-step login procedure and test account references. Example:
### Login Steps
1. Navigate to /login
2. Enter email and password
3. Click "Login" button
4. Redirected to /dashboard

### Test Accounts
- Admin: refer to environment variable \`ADMIN_EMAIL\` / \`ADMIN_PASSWORD\`
-->

(Replace this with the actual authentication flow)

## Common UI Selectors

<!-- List CSS selectors frequently used in browser assertions. Example:
- Navigation: \`nav.main-nav\`
- Form errors: \`.form-error\`, \`[role="alert"]\`
- Modal dialogs: \`[role="dialog"]\`
-->

(Replace this with actual selectors from the project)

## Notes for Test Creation

<!-- Record lessons learned from previous test runs. Example:
- Redirect after login takes ~500ms, use wait step
- File upload requires uploading to /uploads first, then linking to form
-->

(Replace this with actual notes as you learn them)
`;

export function registerMemoryTools(server: McpServer, client: AquaClient) {
  server.tool(
    "get_project_memory",
    "Get project memory containing knowledge accumulated through QA plan creation and execution — app architecture, authentication flows, effective UI selectors, and lessons learned. Review this before creating QA plans to leverage existing insights.",
    {},
    async () => {
      const { content } = await client.getProjectMemory();

      if (!content) {
        return {
          content: [
            {
              type: "text" as const,
              text: MEMORY_TEMPLATE,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: content,
          },
        ],
      };
    }
  );

  server.tool(
    "save_project_memory",
    "Save project memory. Use this to record insights learned during QA plan creation and execution. Overwrites the entire memory content — read the current memory with get_project_memory first, then add new insights and save. IMPORTANT: Only write project-level knowledge (architecture, selectors, authentication flows, test creation notes). Do NOT include environment-specific values such as port numbers, URLs, or credentials — those belong in environment files (.aqua/environments/).",
    {
      content: z
        .string()
        .describe("The full memory content in Markdown format"),
    },
    async ({ content: memoryContent }) => {
      await client.updateProjectMemory(memoryContent);

      return {
        content: [
          {
            type: "text" as const,
            text: "Project memory saved successfully.",
          },
        ],
      };
    }
  );
}
