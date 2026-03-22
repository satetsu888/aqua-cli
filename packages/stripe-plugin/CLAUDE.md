# @aquaqa/stripe-plugin

aqua の Stripe プラグイン。QA ステップとして Stripe API のリソース状態を確認できる。

## ディレクトリ構成

```text
src/
├── index.ts              # AquaPlugin エクスポート（エントリポイント）
├── schemas.ts            # Config & Assertion の Zod スキーマ
├── driver.ts             # StripeDriver（Stripe SDK で API 呼び出し + ポーリング）
└── assertions.ts         # アサーション評価ロジック（stripe_field, stripe_object_exists）
```

## 技術スタック

- stripe - Stripe Node.js SDK
- zod - スキーマ定義（devDependency、CLI から提供）
- @aquaqa/cli/plugin - AquaPlugin インターフェース（peerDependency）
- @aquaqa/cli/utils - getJsonPath, extractValues ユーティリティ

## アクション型: `stripe`

### Config

```typescript
{
  api_key_variable: string,       // API キーの変数名（デフォルト: "stripe_api_key"）
  operation: string,              // Stripe API 操作
  params?: Record<string, string>, // 操作パラメータ（ID、フィルタ等）
  limit?: number,                 // list 系の最大件数（デフォルト: 10）
  poll?: {                        // ポーリング設定（非同期処理の完了待ち）
    interval_ms: number,          // 間隔（デフォルト: 2000）
    timeout_ms: number,           // タイムアウト（デフォルト: 30000）
    until: { path: string, equals: string }  // 終了条件
  }
}
```

### 対応 operation

| 操作 | 必須パラメータ | 説明 |
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

### アサーション型

- **`stripe_field`** — レスポンスのフィールド値を検証。`path`（ドットパス）+ `expected` + `condition`（equals/contains/not_equals/exists/not_exists/greater_than/less_than）
- **`stripe_object_exists`** — オブジェクトの存在/非存在を検証

### 環境設定

Stripe API キーは環境ファイルの secrets 経由で注入:

```jsonc
// .aqua/environments/staging.json
{
  "secrets": {
    "stripe_api_key": { "type": "env", "name": "STRIPE_TEST_SECRET_KEY" }
  }
}
```

既存のマスキング機構（secretKeysRule, secretValueScanRule）でカバー済み。
