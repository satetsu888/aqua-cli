# @aquaqa/stripe-plugin

[aqua](https://aquaqa.com/) の Stripe プラグイン。QA プランで Stripe リソースの状態を確認できます。

QA テストプランに `stripe` アクション型を追加し、顧客、サブスクリプション、決済インテント等の Stripe リソースの状態を検証できます。

## インストール

```bash
npm install @aquaqa/stripe-plugin
```

## セットアップ

### 1. プロジェクト設定に追加

`.aqua/config.json` にプラグインを追加:

```jsonc
{
  "server_url": "https://app.aquaqa.com",
  "project_key": "github.com/owner/repo",
  "plugins": ["@aquaqa/stripe-plugin"]
}
```

### 2. Stripe API キーの設定

環境ファイル（`.aqua/environments/<name>.json`）に Stripe API キーを追加:

```jsonc
{
  "secrets": {
    "stripe_api_key": { "type": "env", "name": "STRIPE_SECRET_KEY" }
  }
}
```

API キーはサーバー送信前に自動的にマスクされます。

## 使い方

QA プランのステップで `stripe` アクション型を使用:

```jsonc
{
  "step_key": "check_subscription",
  "action": "stripe",
  "config": {
    "operation": "get_subscription",
    "params": { "id": "{{subscription_id}}" }
  },
  "assertions": [
    {
      "type": "stripe_field",
      "path": "status",
      "expected": "active",
      "description": "サブスクリプションがアクティブであること"
    }
  ],
  "extract": {
    "plan_id": "$.items.data[0].price.id"
  }
}
```

### ポーリング

非同期処理（Webhook による状態変更等）の完了を待つ場合、`poll` 設定を使用:

```jsonc
{
  "config": {
    "operation": "get_subscription",
    "params": { "id": "{{subscription_id}}" },
    "poll": {
      "interval_ms": 2000,
      "timeout_ms": 30000,
      "until": { "path": "status", "equals": "active" }
    }
  }
}
```

## 対応オペレーション

| オペレーション | 必須パラメータ | 説明 |
|---|---|---|
| `get_customer` | `id` | 顧客を取得 |
| `get_subscription` | `id` | サブスクリプションを取得 |
| `list_subscriptions` | `customer`（任意） | サブスクリプション一覧 |
| `get_payment_intent` | `id` | PaymentIntent を取得 |
| `list_payment_intents` | `customer`（任意） | PaymentIntent 一覧 |
| `get_invoice` | `id` | 請求書を取得 |
| `list_invoices` | `customer`/`subscription`（任意） | 請求書一覧 |
| `get_charge` | `id` | Charge を取得 |
| `list_charges` | `customer`（任意） | Charge 一覧 |
| `get_checkout_session` | `id` | Checkout Session を取得 |
| `get_product` | `id` | Product を取得 |
| `get_price` | `id` | Price を取得 |

## アサーション型

### `stripe_field`

Stripe レスポンスのフィールド値を検証:

```jsonc
{
  "type": "stripe_field",
  "path": "status",                  // ドットパス（例: "items.data[0].price.id"）
  "expected": "active",
  "condition": "equals"              // equals | contains | not_equals | exists | not_exists | greater_than | less_than
}
```

### `stripe_object_exists`

Stripe オブジェクトの存在を検証:

```jsonc
{
  "type": "stripe_object_exists",
  "exists": true
}
```

## ライセンス

MIT
