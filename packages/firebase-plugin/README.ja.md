# @aquaqa/firebase-plugin

[aqua](https://aquaqa.com/) の Firebase プラグイン。QA プランで Firebase リソースの状態を確認できます。

QA テストプランに `firebase` アクション型を追加し、Firestore ドキュメント、Auth ユーザー、Storage ファイル、Realtime Database ノードの状態を検証できます。

## インストール

```bash
npm install @aquaqa/firebase-plugin
```

## セットアップ

### 1. プロジェクト設定に追加

`.aqua/config.json` にプラグインを追加:

```jsonc
{
  "server_url": "https://app.aquaqa.com",
  "project_key": "github.com/owner/repo",
  "plugins": ["@aquaqa/firebase-plugin"]
}
```

### 2. Firebase 認証情報の設定

#### 方式 A: サービスアカウント（個別変数）

環境ファイル（`.aqua/environments/<name>.json`）にサービスアカウントの認証情報を追加:

```jsonc
{
  "secrets": {
    "firebase_project_id": { "type": "env", "name": "FIREBASE_PROJECT_ID" },
    "firebase_client_email": { "type": "env", "name": "FIREBASE_CLIENT_EMAIL" },
    "firebase_private_key": { "type": "env", "name": "FIREBASE_PRIVATE_KEY" }
  }
}
```

#### 方式 B: サービスアカウント JSON ファイル

JSON キーファイルを使う場合:

```jsonc
{
  "variables": {
    "firebase_service_account_path": "/path/to/service-account.json"
  }
}
```

ステップの config で `service_account_path_variable` にこの変数名を指定してください。

#### 方式 C: Firebase Emulator

Firebase Emulator Suite を使ったローカル開発向け。サービスアカウント不要:

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

テスト実行前に `firebase emulators:start` でエミュレータを起動してください。

## 使い方

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
      "description": "注文がペンディング状態であること"
    }
  ],
  "extract": {
    "order_status": "$.status"
  }
}
```

#### Collection Group Query

同名のサブコレクションを横断して検索:

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

### ポーリング

非同期処理（Cloud Functions による DB 書き込み等）の完了を待つ場合:

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

## 対応オペレーション

### Firestore

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `get_document` | `path` | ドキュメントをパスで取得 |
| `list_documents` | `collection` | コレクション内のドキュメントをクエリ |
| `count_documents` | `collection` | フィルタに一致するドキュメント数を取得 |
| `collection_group_query` | `collection_id` | 同名サブコレクションを横断検索 |
| `list_subcollections` | `path` | ドキュメントのサブコレクション一覧を取得 |

### Auth

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `get_user_by_uid` | `uid` | UID でユーザーを取得 |
| `get_user_by_email` | `email` | メールアドレスでユーザーを取得 |
| `get_user_by_phone` | `phone` | 電話番号でユーザーを取得 |
| `list_users` | — | ユーザー一覧を取得（`limit` に従う） |

### Storage

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `list_files` | `prefix` | プレフィックスでファイル一覧を取得 |
| `get_file_metadata` | `path` | ファイルのメタデータを取得 |
| `file_exists` | `path` | ファイルの存在を確認 |

### Realtime Database

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `get_node` | `path` | パスの値を取得 |
| `query_nodes` | `path` + `rtdb_query` | ソート・フィルタ付きでノードをクエリ |

## アサーション型

### `firebase_field`

レスポンスのフィールド値を検証:

```jsonc
{
  "type": "firebase_field",
  "path": "status",                  // ドットパス（例: "metadata.plan", "items[0].name"）
  "expected": "active",
  "condition": "equals"              // equals | not_equals | contains | exists | not_exists | greater_than | less_than
}
```

### `firebase_document_exists`

ドキュメント/ユーザー/ノードの存在を検証:

```jsonc
{
  "type": "firebase_document_exists",
  "exists": true
}
```

### `firebase_count`

結果の件数を検証:

```jsonc
{
  "type": "firebase_count",
  "expected": 3,
  "condition": "equals"              // equals | greater_than | less_than
}
```

## データ型の自動変換

Firestore 固有のデータ型はアサーションで扱いやすい形式に自動変換されます:

| Firestore 型 | 変換先 | 例 |
|---|---|---|
| `Timestamp` | ISO 8601 文字列 | `"2024-03-23T12:34:56.000Z"` |
| `GeoPoint` | `{ latitude, longitude }` | `{ latitude: 35.68, longitude: 139.76 }` |
| `DocumentReference` | ドキュメントパス文字列 | `"users/abc123"` |
| `Bytes` | Base64 文字列 | `"SGVsbG8="` |

これにより、`firebase_field` アサーションで直接検証できます:

```jsonc
// DocumentReference フィールドの検証
{ "type": "firebase_field", "path": "authorRef", "expected": "users/abc123" }

// GeoPoint の緯度を検証
{ "type": "firebase_field", "path": "location.latitude", "expected": "35", "condition": "greater_than" }

// Timestamp の存在確認
{ "type": "firebase_field", "path": "createdAt", "expected": "", "condition": "exists" }
```

## ライセンス

MIT
