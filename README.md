# @satetsu888/aqua-cli

CLI and MCP Server for **aqua** — a QA planning and execution service designed for AI agents.

aqua lets AI agents (such as Claude Code) create QA test plans and execute them via HTTP and browser automation. This package provides the CLI tool and [MCP](https://modelcontextprotocol.io/) server that acts as the bridge between AI agents and the aqua backend.

## Architecture

```text
AI Agent (Claude Code, etc.)
  ↕ MCP Protocol (stdio)
@satetsu888/aqua-cli (this package)    ← MCP server + test execution engine
  ↕ HTTP REST API
aqua Backend Server (Go)           ← data persistence & API
  ↕
DB (SQLite / PostgreSQL)
```

The CLI embeds two test drivers:

- **HTTP Driver** — sends HTTP requests and validates responses
- **Browser Driver** — automates browsers via Playwright (navigate, click, fill, screenshot, iframe switching, etc.)

## Prerequisites

An aqua backend server must be running. The easiest way is Docker:

```bash
# In the aqua repository root
docker compose up -d    # starts server at http://localhost:9080
```

## Setup

### 1. Login

Authenticate with the aqua server:

```bash
npx @satetsu888/aqua-cli login --server-url http://localhost:9080
```

This opens a browser for authentication and saves credentials to `~/.aqua/credentials.json`.

### 2. Initialize configuration

Run this in your project root:

```bash
npx @satetsu888/aqua-cli init --server-url http://localhost:9080
```

This creates `.aqua/config.json` with `server_url` and `project_key`. The MCP server reads it automatically on startup.

If `--server-url` is omitted, it defaults to `http://localhost:9080`.

### 3. Use with Claude Code

Start Claude Code with aqua as an MCP server:

```bash
claude --mcp-config '{"mcpServers":{"aqua":{"command":"npx","args":["@satetsu888/aqua-cli","mcp-server"]}}}'
```

## CLI Commands

### `aqua-cli login`

Authenticate with the aqua server.

```bash
aqua-cli login [--server-url <url>] [--force]
```

- `--force` — re-authenticate even if credentials already exist

### `aqua-cli logout`

Remove saved credentials for the server.

```bash
aqua-cli logout [--server-url <url>]
```

### `aqua-cli init`

Initialize project configuration: select organization and project.

```bash
aqua-cli init [--server-url <url>]
```

### `aqua-cli whoami`

Show the currently authenticated user.

```bash
aqua-cli whoami [--server-url <url>]
```

### `aqua-cli execute`

Execute a QA plan and report results.

```bash
aqua-cli execute <qa_plan_id> [--env <name>] [--plan-version <n>] [--var key=value]
```

- `--env <name>` — load environment from `.aqua/environments/<name>.json`
- `--plan-version <n>` — execute a specific version (defaults to latest)
- `--var key=value` — variable override (repeatable)

### `aqua-cli record`

Record browser actions using Playwright codegen. Opens a Chromium browser for you to operate; outputs `BrowserStep[]` JSON to stdout when you close the browser.

```bash
aqua-cli record [url]
```

- `[url]` — initial URL to navigate to (optional)

The output can be used directly with `update_qa_plan`, `create_common_scenario`, or `run_scenario`.

### `aqua-cli web`

Open the web UI in your browser (requires login).

```bash
aqua-cli web [--server-url <url>]
```

### `aqua-cli mcp-server`

Start the MCP server for AI agent integration.

```bash
aqua-cli mcp-server [--server-url <url>]
```

Server URL is resolved in this order:

1. `--server-url` flag
2. `AQUA_SERVER_URL` environment variable
3. `.aqua/config.json`
4. Default (`http://localhost:9080`)

## MCP Tools

Once the MCP server is running, the following tools are available to the AI agent:

### Plan Management

| Tool | Description |
|------|-------------|
| `create_qa_plan` | Create a new QA plan |
| `get_qa_plan` | Get a plan by ID |
| `list_qa_plans` | List plans (filter by status) |
| `update_qa_plan` | Create a new version of a plan with scenarios and steps |
| `update_qa_plan_step` | Partial update of a single step (creates new version) |
| `add_qa_plan_step` | Add a step to a scenario (creates new version) |
| `remove_qa_plan_step` | Remove a step (creates new version) |
| `set_qa_plan_status` | Change plan status (draft / active / archived) |

### Execution

| Tool | Description |
|------|-------------|
| `execute_qa_plan` | Execute a plan — runs all scenarios and records results |
| `run_scenario` | Run a single scenario inline (no server recording, for quick iteration) |
| `get_execution` | Get execution results with step details |
| `list_executions` | List executions (filter by plan version or status) |

### Environment

| Tool | Description |
|------|-------------|
| `create_environment` | Create a new environment config file (`.aqua/environments/<name>.json`) |
| `list_environments` | List available environments in `.aqua/environments/` |
| `validate_environment` | Validate an environment config file (schema + env vars check) |

### Common Scenario

| Tool | Description |
|------|-------------|
| `create_common_scenario` | Create a reusable scenario template at the project level |
| `get_common_scenario` | Get a common scenario by ID |
| `list_common_scenarios` | List common scenarios in the project |
| `update_common_scenario` | Update a common scenario |
| `delete_common_scenario` | Delete a common scenario |

### Recording

| Tool | Description |
|------|-------------|
| `record_browser_actions` | Open a browser for the user to operate and record actions as `BrowserStep[]` |

### Memory

| Tool | Description |
|------|-------------|
| `get_project_memory` | Get project memory (returns template if empty) |
| `save_project_memory` | Save project memory (full overwrite) |

## Configuration

### `~/.aqua/credentials.json`

Stores server authentication credentials (per server URL). Managed by `aqua-cli login` / `aqua-cli logout`.

### `.aqua/config.json`

```json
{
  "server_url": "http://localhost:9080",
  "project_key": "github.com/owner/repo"
}
```

### Environment Files

Environment files are stored at `.aqua/environments/<name>.json` and define variables and secrets for test execution. Create them with the `create_environment` MCP tool or manually.

```jsonc
{
  "notes": "Staging environment — VPN required",
  "variables": {
    "api_base_url": "https://staging-api.example.com",
    "web_base_url": "https://staging.example.com"
  },
  "secrets": {
    "api_key": { "type": "literal", "value": "dev-key-123" },
    "auth_token": { "type": "env", "value": "STAGING_AUTH_TOKEN" },
    "db_password": { "type": "op", "value": "op://Development/staging-db/password" },
    "aws_secret": { "type": "aws_sm", "value": "staging/db-creds", "json_key": "password" },
    "gcp_secret": { "type": "gcp_sm", "value": "staging-api-key" },
    "vault_secret": { "type": "hcv", "value": "myapp/staging/keys", "field": "signing_key" }
  },
  "secret_providers": {
    "hcv": { "address": "https://vault.example.com:8200" },
    "aws_sm": { "region": "ap-northeast-1", "profile": "staging" },
    "gcp_sm": { "project": "my-project-123" }
  }
}
```

#### Secret Types

| Type | Source | CLI Required | Value Format |
|------|--------|-------------|--------------|
| `literal` | Inline value | None | Plain text |
| `env` | Process environment variable | None | Variable name (e.g. `MY_TOKEN`) |
| `op` | 1Password | `op` | Secret reference URI (e.g. `op://vault/item/field`) |
| `aws_sm` | AWS Secrets Manager | `aws` | Secret name or ARN |
| `gcp_sm` | GCP Secret Manager | `gcloud` | Secret name |
| `hcv` | HashiCorp Vault | `vault` | Secret path (e.g. `myapp/staging/db`) |

**Per-entry options for `aws_sm`:**
- `region` (optional) — AWS region override for this specific secret
- `json_key` (optional) — Extract a specific key from a JSON-formatted secret

**Per-entry options for `gcp_sm`:**
- `project` (optional) — GCP project override for this specific secret
- `version` (optional) — Secret version. Defaults to `latest`
- `json_key` (optional) — Extract a specific key from a JSON-formatted secret

**Per-entry options for `hcv`:**
- `field` (optional) — Specific field to retrieve from the KV secret
- `mount` (optional) — KV mount point. Defaults to `secret`

#### Provider Configuration (`secret_providers`)

Provider-level defaults for external secret resolvers. These apply to all secrets of the corresponding type. Per-entry options take precedence over provider defaults.

| Provider | Key | Description |
|----------|-----|-------------|
| `hcv` | `address` | Vault server URL (equivalent to `VAULT_ADDR` env var) |
| `hcv` | `namespace` | Vault namespace (for Vault Enterprise) |
| `aws_sm` | `region` | Default AWS region for all `aws_sm` secrets |
| `aws_sm` | `profile` | AWS named profile to use |
| `gcp_sm` | `project` | Default GCP project for all `gcp_sm` secrets |

This is the recommended way to configure external resolvers, especially when running as an MCP server where process environment variables may not be available.

Secrets are resolved locally at execution time. Only secrets actually referenced by the QA plan (via `{{variable}}` templates) are resolved — unused secrets don't require CLI authentication. All secret values are masked (`***`) before being sent to the server.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AQUA_SERVER_URL` | Override the server URL |

## License

MIT
