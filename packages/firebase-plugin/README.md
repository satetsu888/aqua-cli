# @aquaqa/firebase-plugin

Firebase plugin for [aqua](https://aquaqa.com/) — verify Firebase resource states in your QA plans.

This plugin adds a `firebase` action type to aqua, allowing you to check the state of Firebase resources (Firestore documents, Auth users, Storage files, Realtime Database nodes) as part of your QA test plans.

[日本語 README](./README.ja.md)

## Installation

```bash
npm install @aquaqa/firebase-plugin
```

## Setup

### 1. Add to project config

Add the plugin to your `.aqua/config.json`:

```jsonc
{
  "server_url": "https://app.aquaqa.com",
  "project_key": "github.com/owner/repo",
  "plugins": ["@aquaqa/firebase-plugin"]
}
```

### 2. Configure Firebase credentials

#### Option A: Service Account (individual variables)

Add your Firebase service account credentials to an environment file (`.aqua/environments/<name>.json`):

```jsonc
{
  "secrets": {
    "firebase_project_id": { "type": "env", "name": "FIREBASE_PROJECT_ID" },
    "firebase_client_email": { "type": "env", "name": "FIREBASE_CLIENT_EMAIL" },
    "firebase_private_key": { "type": "env", "name": "FIREBASE_PRIVATE_KEY" }
  }
}
```

#### Option B: Service Account JSON file

If you prefer using a JSON key file:

```jsonc
{
  "variables": {
    "firebase_service_account_path": "/path/to/service-account.json"
  }
}
```

Set `service_account_path_variable` in your step config to use this variable name.

#### Option C: Firebase Emulator

For local development with Firebase Emulator Suite. No service account is needed:

```jsonc
{
  "variables": {
    "firebase_emulator": "true",
    "firebase_project_id": "demo-test-project",
    "firebase_firestore_emulator_host": "localhost:8080",
    "firebase_auth_emulator_host": "localhost:9099",
    "firebase_storage_emulator_host": "localhost:9199",
    "firebase_database_emulator_host": "localhost:9000"
  }
}
```

Start your emulators with `firebase emulators:start` before running tests.

## Usage

### Firestore

```jsonc
{
  "step_key": "check_order",
  "action": "firebase",
  "config": {
    "operation": "get_document",
    "params": { "path": "orders/{{order_id}}" }
  },
  "assertions": [
    {
      "type": "firebase_document_exists",
      "exists": true
    },
    {
      "type": "firebase_field",
      "path": "status",
      "expected": "pending",
      "description": "Order should be pending"
    }
  ],
  "extract": {
    "order_status": "$.status"
  }
}
```

#### Collection Group Query

Query across all subcollections with the same name:

```jsonc
{
  "config": {
    "operation": "collection_group_query",
    "params": { "collection_id": "orders" },
    "filters": [
      { "field": "status", "operator": "eq", "value": "pending" }
    ],
    "order_by": { "field": "createdAt", "direction": "desc" },
    "limit": 10
  }
}
```

### Auth

```jsonc
{
  "config": {
    "operation": "get_user_by_email",
    "params": { "email": "{{test_email}}" }
  },
  "assertions": [
    { "type": "firebase_document_exists", "exists": true },
    { "type": "firebase_field", "path": "displayName", "expected": "{{display_name}}" }
  ]
}
```

### Storage

```jsonc
{
  "config": {
    "operation": "file_exists",
    "params": { "path": "avatars/{{user_uid}}.png" }
  },
  "assertions": [
    { "type": "firebase_document_exists", "exists": true }
  ]
}
```

### Realtime Database

```jsonc
{
  "config": {
    "operation": "get_node",
    "params": { "path": "presence/{{user_uid}}" }
  },
  "assertions": [
    { "type": "firebase_field", "path": "online", "expected": "true" }
  ]
}
```

### Polling

For async operations (e.g., waiting for a Cloud Function to write data):

```jsonc
{
  "config": {
    "operation": "get_document",
    "params": { "path": "payments/{{payment_id}}" },
    "poll": {
      "interval_ms": 2000,
      "timeout_ms": 30000,
      "until": { "path": "status", "equals": "completed" }
    }
  }
}
```

## Supported Operations

### Firestore

| Operation | Required Params | Description |
|---|---|---|
| `get_document` | `path` | Get a document by path |
| `list_documents` | `collection` | Query documents in a collection |
| `count_documents` | `collection` | Count documents matching filters |
| `collection_group_query` | `collection_id` | Query across all subcollections with the same name |
| `list_subcollections` | `path` | List subcollections of a document |

### Auth

| Operation | Required Params | Description |
|---|---|---|
| `get_user_by_uid` | `uid` | Get user by UID |
| `get_user_by_email` | `email` | Get user by email |
| `get_user_by_phone` | `phone` | Get user by phone number |
| `list_users` | — | List users (respects `limit`) |

### Storage

| Operation | Required Params | Description |
|---|---|---|
| `list_files` | `prefix` | List files by prefix |
| `get_file_metadata` | `path` | Get file metadata |
| `file_exists` | `path` | Check if a file exists |

### Realtime Database

| Operation | Required Params | Description |
|---|---|---|
| `get_node` | `path` | Get value at a path |
| `query_nodes` | `path` + `rtdb_query` | Query nodes with ordering and filtering |

## Assertion Types

### `firebase_field`

Check a field value in the response:

```jsonc
{
  "type": "firebase_field",
  "path": "status",                  // dot-path (e.g. "metadata.plan", "items[0].name")
  "expected": "active",
  "condition": "equals"              // equals | not_equals | contains | exists | not_exists | greater_than | less_than
}
```

### `firebase_document_exists`

Check whether the document/user/node exists:

```jsonc
{
  "type": "firebase_document_exists",
  "exists": true
}
```

### `firebase_count`

Check the number of results:

```jsonc
{
  "type": "firebase_count",
  "expected": 3,
  "condition": "equals"              // equals | greater_than | less_than
}
```

## Data Type Handling

Firestore-specific data types are automatically converted to assertion-friendly formats:

| Firestore Type | Converted To | Example |
|---|---|---|
| `Timestamp` | ISO 8601 string | `"2024-03-23T12:34:56.000Z"` |
| `GeoPoint` | `{ latitude, longitude }` | `{ latitude: 35.68, longitude: 139.76 }` |
| `DocumentReference` | Document path string | `"users/abc123"` |
| `Bytes` | Base64 string | `"SGVsbG8="` |

This means you can use `firebase_field` assertions directly on these types:

```jsonc
// Check a DocumentReference field
{ "type": "firebase_field", "path": "authorRef", "expected": "users/abc123" }

// Check a GeoPoint latitude
{ "type": "firebase_field", "path": "location.latitude", "expected": "35", "condition": "greater_than" }

// Check a Timestamp exists
{ "type": "firebase_field", "path": "createdAt", "expected": "", "condition": "exists" }
```

## License

MIT
