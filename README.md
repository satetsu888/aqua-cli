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
- **Browser Driver** — automates browsers via Playwright (navigate, click, fill, screenshot, etc.)

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

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AQUA_SERVER_URL` | Override the server URL |

## License

MIT
