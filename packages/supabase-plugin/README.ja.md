# @aquaqa/supabase-plugin

[aqua](https://aquaqa.com/) の Supabase プラグイン。QA プランで Supabase リソースの状態を確認できます。

QA テストプランに `supabase` アクション型を追加し、データベースの行、Auth ユーザー、Storage のファイル等の Supabase リソースの状態を検証できます。

## インストール

```bash
npm install @aquaqa/supabase-plugin
```

## セットアップ

### 1. プロジェクト設定に追加

`.aqua/config.json` にプラグインを追加:

```jsonc
{
  "server_url": "https://app.aquaqa.com",
  "project_key": "github.com/owner/repo",
  "plugins": ["@aquaqa/supabase-plugin"]
}
```

### 2. Supabase 認証情報の設定

環境ファイル（`.aqua/environments/<name>.json`）に Supabase URL と service role キーを追加:

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

service role キーは Row Level Security（RLS）をバイパスするため、RLS ポリシーに関係なくすべてのデータを検証できます。キーはサーバー送信前に自動的にマスクされます。

## 使い方

QA プランのステップで `supabase` アクション型を使用:

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
      "description": "注文が存在すること"
    },
    {
      "type": "supabase_field",
      "path": "status",
      "expected": "pending",
      "description": "注文ステータスが pending であること"
    }
  ],
  "extract": {
    "user_id": "$.user_id"
  }
}
```

### ポーリング

非同期処理（Edge Function や Webhook による状態変更等）の完了を待つ場合、`poll` 設定を使用:

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

### フィルタ

`list_rows` と `count_rows` では `filters` で結果を絞り込み:

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

利用可能なフィルタ演算子: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `contains`, `containedBy`

## 対応オペレーション

### Database

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `get_row` | `table`, `column`, `value` | 列の値で1行取得 |
| `list_rows` | `table` | フィルタ付きで複数行取得 |
| `count_rows` | `table` | フィルタに合う行数を取得 |
| `call_rpc` | `function_name` + 追加パラメータ | Postgres 関数を呼び出し |

- `get_row` と `list_rows` は `select` オプションでカラム指定や PostgREST の JOIN（例: `"*, order_items(*)"`) に対応
- `list_rows` と `count_rows` は `filters` でクエリ条件を指定可能
- `list_rows` は `limit`（デフォルト: 10）に対応

### Auth

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `get_user_by_id` | `id` | ID でユーザーを取得 |
| `list_users` | — | Auth ユーザー一覧を取得 |
| `get_user_by_email` | `email` | メールアドレスでユーザーを検索 |

Auth オペレーションは管理者 API を使用し、`user_metadata`、`app_metadata`、`email_confirmed_at` 等を含む完全なユーザーオブジェクトを返します。

### Storage

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `list_files` | `bucket`、`path`（任意） | バケット/フォルダ内のファイル一覧 |
| `get_bucket` | `id` | バケット設定を取得 |
| `list_buckets` | — | 全バケット一覧を取得 |
| `download_file` | `bucket`, `path` | ファイルをダウンロード（サイズとタイプを返す） |

### Edge Functions

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `invoke_function` | `name`、`body`（任意、JSON文字列） | Edge Function を呼び出し |

## アサーション型

### `supabase_field`

レスポンスのフィールド値を検証:

```jsonc
{
  "type": "supabase_field",
  "path": "status",                  // ドットパス（例: "metadata.plan_tier", "items[0].name"）
  "expected": "active",
  "condition": "equals"              // equals | contains | not_equals | exists | not_exists | greater_than | less_than
}
```

### `supabase_row_exists`

行の存在を検証:

```jsonc
{
  "type": "supabase_row_exists",
  "exists": true                     // true: 存在すべき、false: 存在しないべき
}
```

### `supabase_row_count`

返された行数を検証:

```jsonc
{
  "type": "supabase_row_count",
  "expected": 3,
  "condition": "equals"              // equals | greater_than | less_than
}
```

## 使用例

### ユーザーサインアップの検証

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

### ファイルアップロードの検証

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

### 一括操作後の行数検証

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

### 論理削除の検証

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

## ライセンス

MIT
