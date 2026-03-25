# @aquaqa/supabase-plugin

Supabase plugin for [aqua](https://aquaqa.com/) — verify Supabase resource states in your QA plans.

This plugin adds a `supabase` action type to aqua, allowing you to check the state of Supabase resources (database rows, auth users, storage files, etc.) as part of your QA test plans.

[日本語 README](./README.ja.md)

## Installation

```bash
npm install @aquaqa/supabase-plugin
```

## Setup

### 1. Add to project config

Add the plugin to your `.aqua/config.json`:

```jsonc
{
  "server_url": "https://app.aquaqa.com",
  "project_key": "github.com/owner/repo",
  "plugins": ["@aquaqa/supabase-plugin"]
}
```

### 2. Configure Supabase credentials

Add your Supabase URL and service role key to an environment file (`.aqua/environments/<name>.json`):

```jsonc
{
  "variables": {
    "supabase_url": "https://your-project.supabase.co"
  },
  "secrets": {
    "supabase_service_role_key": { "type": "env", "name": "SUPABASE_SERVICE_ROLE_KEY" }
  }
}
```

The service role key bypasses Row Level Security (RLS), enabling the plugin to verify all data regardless of RLS policies. The key is automatically masked before being sent to the aqua server.

## Usage

Use the `supabase` action type in your QA plan steps:

```jsonc
{
  "step_key": "check_order",
  "action": "supabase",
  "config": {
    "operation": "get_row",
    "params": { "table": "orders", "column": "id", "value": "{{order_id}}" },
    "select": "*, order_items(*)"
  },
  "assertions": [
    {
      "type": "supabase_row_exists",
      "exists": true,
      "description": "Order should exist"
    },
    {
      "type": "supabase_field",
      "path": "status",
      "expected": "pending",
      "description": "Order status should be pending"
    }
  ],
  "extract": {
    "user_id": "$.user_id"
  }
}
```

### Polling

For async operations (e.g., waiting for an Edge Function or webhook to update a row), use the `poll` config:

```jsonc
{
  "config": {
    "operation": "get_row",
    "params": { "table": "orders", "column": "id", "value": "{{order_id}}" },
    "poll": {
      "interval_ms": 2000,
      "timeout_ms": 30000,
      "until": { "path": "status", "equals": "completed" }
    }
  }
}
```

### Filters

For `list_rows` and `count_rows`, use `filters` to narrow results:

```jsonc
{
  "config": {
    "operation": "list_rows",
    "params": { "table": "orders" },
    "filters": [
      { "column": "user_id", "operator": "eq", "value": "{{user_id}}" },
      { "column": "status", "operator": "neq", "value": "cancelled" }
    ],
    "select": "id, status, total",
    "limit": 20
  }
}
```

Available filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `contains`, `containedBy`

## Supported Operations

### Database

| Operation | Required Params | Description |
|---|---|---|
| `get_row` | `table`, `column`, `value` | Retrieve a single row by column value |
| `list_rows` | `table` | List rows with optional filters |
| `count_rows` | `table` | Count rows matching filters |
| `call_rpc` | `function_name` + additional params | Call a Postgres function |

- `get_row` and `list_rows` support the `select` option for column selection and PostgREST joins (e.g., `"*, order_items(*)"`)
- `list_rows` and `count_rows` support `filters` for query conditions
- `list_rows` supports `limit` (default: 10)

### Auth

| Operation | Required Params | Description |
|---|---|---|
| `get_user_by_id` | `id` | Retrieve a user by ID |
| `list_users` | — | List auth users |
| `get_user_by_email` | `email` | Find a user by email address |

Auth operations use the admin API, returning full user objects including `user_metadata`, `app_metadata`, `email_confirmed_at`, etc.

### Storage

| Operation | Required Params | Description |
|---|---|---|
| `list_files` | `bucket`, `path` (optional) | List files in a bucket/folder |
| `get_bucket` | `id` | Retrieve bucket configuration |
| `list_buckets` | — | List all buckets |
| `download_file` | `bucket`, `path` | Download a file (returns size and type) |

### Edge Functions

| Operation | Required Params | Description |
|---|---|---|
| `invoke_function` | `name`, `body` (optional, JSON string) | Invoke an Edge Function |

## Assertion Types

### `supabase_field`

Check a field value in the response:

```jsonc
{
  "type": "supabase_field",
  "path": "status",                  // dot-path (e.g. "metadata.plan_tier", "items[0].name")
  "expected": "active",
  "condition": "equals"              // equals | contains | not_equals | exists | not_exists | greater_than | less_than
}
```

### `supabase_row_exists`

Check whether a row exists:

```jsonc
{
  "type": "supabase_row_exists",
  "exists": true                     // true: should exist, false: should not exist
}
```

### `supabase_row_count`

Check the number of rows returned:

```jsonc
{
  "type": "supabase_row_count",
  "expected": 3,
  "condition": "equals"              // equals | greater_than | less_than
}
```

## Examples

### Verify user signup

```jsonc
[
  {
    "step_key": "check_auth_user",
    "action": "supabase",
    "config": {
      "operation": "get_user_by_email",
      "params": { "email": "{{test_email}}" }
    },
    "assertions": [
      { "type": "supabase_row_exists", "exists": true },
      {
        "type": "supabase_field",
        "path": "user_metadata.display_name",
        "expected": "{{display_name}}"
      }
    ],
    "extract": { "auth_user_id": "$.id" }
  },
  {
    "step_key": "check_profile",
    "action": "supabase",
    "config": {
      "operation": "get_row",
      "params": { "table": "profiles", "column": "id", "value": "{{auth_user_id}}" }
    },
    "assertions": [
      { "type": "supabase_row_exists", "exists": true },
      { "type": "supabase_field", "path": "email", "expected": "{{test_email}}" }
    ]
  }
]
```

### Verify file upload

```jsonc
{
  "step_key": "check_avatar",
  "action": "supabase",
  "config": {
    "operation": "list_files",
    "params": { "bucket": "avatars", "path": "{{user_id}}" }
  },
  "assertions": [
    { "type": "supabase_row_count", "expected": 1 },
    {
      "type": "supabase_field",
      "path": "[0].metadata.mimetype",
      "expected": "image/png"
    }
  ]
}
```

### Verify row count after bulk operation

```jsonc
{
  "step_key": "check_import_count",
  "action": "supabase",
  "config": {
    "operation": "list_rows",
    "params": { "table": "imports" },
    "filters": [
      { "column": "batch_id", "operator": "eq", "value": "{{batch_id}}" }
    ],
    "limit": 100
  },
  "assertions": [
    { "type": "supabase_row_count", "expected": 50 }
  ]
}
```

### Verify row deleted (soft delete)

```jsonc
{
  "step_key": "check_soft_delete",
  "action": "supabase",
  "config": {
    "operation": "get_row",
    "params": { "table": "posts", "column": "id", "value": "{{post_id}}" }
  },
  "assertions": [
    {
      "type": "supabase_field",
      "path": "deleted_at",
      "expected": "",
      "condition": "exists"
    }
  ]
}
```

## License

MIT
