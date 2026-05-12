# @aquaqa/cli

**aqua** の CLI ツール兼 MCP Server。aqua は AI エージェント向けの QA 計画・実行サービスです。

AI エージェント（Claude Code など）が QA テストプランを作成し、HTTP リクエストやブラウザ自動操作で実行できます。本パッケージは AI エージェントと aqua サーバーをつなぐ CLI ツールと [MCP](https://modelcontextprotocol.io/) サーバーを提供します。

**Website:** https://aquaqa.com/ | **Docs:** https://aquaqa.com/docs/

## セットアップ

### 1. ログイン

aqua サーバーに認証します:

```bash
npx @aquaqa/cli login
```

ブラウザが開き、認証完了後に認証情報が `~/.aqua/credentials.json` に保存されます。

### 2. プロジェクトの初期化

プロジェクトルートで実行します:

```bash
npx @aquaqa/cli init
```

`.aqua/config.json` に `server_url` と `project_key` が保存されます。MCP サーバー起動時に自動で読み込まれます。

### 3. コーディングエージェントとの連携

詳しくは [Coding Agent Setup ガイド](https://aquaqa.com/docs/getting-started/installation/#3-coding-agent-setup) を参照してください。

Claude Code で手軽に試す場合:

```bash
claude --mcp-config '{"mcpServers":{"aqua":{"command":"npx","args":["@aquaqa/cli","mcp-server"]}}}' --allowedTools 'mcp__aqua__*'
```

## アーキテクチャ

```text
AI Agent (Claude Code, etc.)
  ↕ MCP Protocol (stdio)
@aquaqa/cli (this package)    ← MCP server + test execution engine
  ↕ HTTP REST API
aqua Server                   ← data persistence & API
```

CLI には 2 つのテストドライバーが内蔵されています:

- **HTTP Driver** — あらゆる Content-Type の HTTP リクエストを送信し(JSON / form-urlencoded / ファイルアップロード multipart / 生テキスト・XML / 生バイナリ / GraphQL)、レスポンスを検証。Basic 認証 (RFC 7617) と Bearer 認証 (RFC 6750) の `auth` ヘルパー内蔵 — テンプレート展開された認証情報から `Authorization` ヘッダーをランナーが組み立てるため、シークレットは環境ファイルに置いたままにできる。バイナリレスポンス(PDF・画像・ダウンロード)はストリーミング読み込み + SHA-256 ハッシュ + サイズキャップ対応。アサーションは status / JSON path / ヘッダー / body サイズ / body ハッシュ / body 部分一致をカバー
- **Browser Driver** — Playwright によるブラウザ自動操作(ナビゲーション、クリック、入力、スクリーンショット、iframe 切り替えなど)

## CLI コマンド

### `aqua-cli login`

aqua サーバーに認証します。

```bash
aqua-cli login [--force]
```

- `--force` — 既存の認証情報がある場合でも再認証

### `aqua-cli logout`

保存された認証情報を削除します。

```bash
aqua-cli logout
```

### `aqua-cli init`

プロジェクト設定を初期化します（組織とプロジェクトを選択）。

```bash
aqua-cli init
```

### `aqua-cli whoami`

現在認証中のユーザー情報を表示します。

```bash
aqua-cli whoami
```

### `aqua-cli execute`

QA プランを実行し、結果を記録します。

```bash
aqua-cli execute <qa_plan_id> [--env <name>] [--plan-version <n>] [--var key=value]
```

- `--env <name>` — `.aqua/environments/<name>.json` から環境を読み込み
- `--plan-version <n>` — 特定バージョンを実行（デフォルトは最新）
- `--var key=value` — 変数のオーバーライド（複数指定可）

### `aqua-cli record`

Playwright codegen でブラウザ操作を記録します。Chromium ブラウザが開き、操作後にブラウザを閉じると `BrowserStep[]` の JSON が stdout に出力されます。

```bash
aqua-cli record [url]
```

- `[url]` — 初期 URL（省略可）

出力は `update_qa_plan`、`create_common_scenario`、`run_scenario` にそのまま使用できます。

### `aqua-cli plugin`

プラグインの管理。カスタムアクション型で aqua を拡張できます。

```bash
aqua-cli plugin add <package>      # プラグインをインストールして設定に追加
aqua-cli plugin remove <package>   # プラグインを設定から削除してアンインストール
aqua-cli plugin list               # 設定済みプラグインの一覧表示
```

- `add` — `npm install` を実行し、`.aqua/config.json` の `plugins` 配列に追加
- `remove` — `.aqua/config.json` から削除し、`npm uninstall` を実行
- `list` — 設定済みプラグインを表示

例:

```bash
aqua-cli plugin add @aquaqa/stripe-plugin
```

### `aqua-cli web`

Web UI をブラウザで開きます（ログインが必要）。

```bash
aqua-cli web
```

### `aqua-cli mcp-server`

AI エージェント連携用の MCP サーバーを起動します。

```bash
aqua-cli mcp-server
```

サーバー URL は以下の優先順位で解決されます:

1. `AQUA_SERVER_URL` 環境変数
2. `.aqua/config.json`
3. デフォルト（`https://app.aquaqa.com`）

## MCP ツール

MCP サーバー起動後、AI エージェントから以下のツールが利用できます:

### プラン管理

| ツール | 説明 |
|------|------|
| `create_qa_plan` | QA プランを作成 |
| `get_qa_plan` | ID でプランを取得 |
| `list_qa_plans` | プラン一覧（ステータスでフィルタ可能） |
| `update_qa_plan` | シナリオとステップを指定してプランの新バージョンを作成 |
| `update_qa_plan_step` | 単一ステップの部分更新（新バージョン作成） |
| `add_qa_plan_step` | シナリオにステップを追加（新バージョン作成） |
| `remove_qa_plan_step` | ステップを削除（新バージョン作成） |
| `set_qa_plan_status` | プランのステータスを変更（draft / active / archived） |
| `pin_qa_plan` | プランのピン留め/解除（`list_qa_plans` のフィルタで素早くアクセス） |

### 実行

| ツール | 説明 |
|------|------|
| `execute_qa_plan` | プランを実行（全シナリオを実行し結果を記録） |
| `run_scenario` | 単一シナリオを直接実行（サーバー記録なし） |
| `get_execution` | 実行結果を取得（ステップ詳細含む） |
| `list_executions` | 実行一覧（プランバージョンやステータスでフィルタ可能） |
| `get_execution_progress` | 実行中の進捗をステップ単位で取得 |

### 探索

ページ構造や CSS セレクタ、API レスポンス形式を 1 アクションずつ確認するインタラクティブな探索セッション。対象アプリの構造が不明な段階でシナリオ構築前に使用します。

| ツール | 説明 |
|------|------|
| `start_exploration` | 探索セッションを開始（ブラウザはアクション間で維持） |
| `explore_action` | ブラウザ操作、HTTP リクエスト、ブラウザアサーションを実行して即座にフィードバックを取得 |
| `end_exploration` | セッションを終了しリソースを解放 |

**探索 vs run_scenario:**

- **`start_exploration` → `explore_action`**: ページ構造が*わからない*ときに使用。各ブラウザ操作で DOM 全体とスクリーンショットが返され、セレクタを発見できます。
- **`run_scenario`**: 完成したシナリオ定義が*すでにある*ときに、一括で検証するために使用。

### 環境

| ツール | 説明 |
|------|------|
| `create_environment` | 環境設定ファイルを作成（`.aqua/environments/<name>.json`） |
| `list_environments` | `.aqua/environments/` 内の利用可能な環境を一覧表示 |
| `validate_environment` | 環境設定ファイルを検証（スキーマ・環境変数チェック） |

### 共通シナリオ

| ツール | 説明 |
|------|------|
| `create_common_scenario` | プロジェクトレベルの再利用可能なシナリオテンプレートを作成 |
| `get_common_scenario` | ID で共通シナリオを取得 |
| `list_common_scenarios` | プロジェクト内の共通シナリオを一覧表示 |
| `update_common_scenario` | 共通シナリオを更新 |
| `delete_common_scenario` | 共通シナリオを削除 |

### セットアップ

| ツール | 説明 |
|------|------|
| `check_project_setup` | プロジェクトのセットアップ状態を確認（設定、メモリ、環境、共通シナリオ） |

### レコーディング

| ツール | 説明 |
|------|------|
| `record_browser_actions` | ブラウザを開いてユーザー操作を `BrowserStep[]` として記録 |

### メモリ

| ツール | 説明 |
|------|------|
| `get_project_memory` | プロジェクトメモリを取得（未設定時はテンプレートを返却） |
| `save_project_memory` | プロジェクトメモリを保存（全体上書き） |

## 設定

### `~/.aqua/credentials.json`

サーバー認証情報を保存（サーバー URL ごと）。`aqua-cli login` / `aqua-cli logout` で管理されます。

`AQUA_API_KEY` 環境変数が設定されている場合、credentials ファイルよりも優先されます。ブラウザログインが利用できない CI/CD 環境で便利です。

### `.aqua/config.json`

```json
{
  "server_url": "https://app.aquaqa.com",
  "project_key": "github.com/owner/repo"
}
```

### 環境ファイル

環境ファイルは `.aqua/environments/<name>.json` に配置し、テスト実行用の変数とシークレットを定義します。`create_environment` MCP ツールまたは手動で作成できます。

```jsonc
{
  "notes": "ステージング環境 — VPN 接続が必要",
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
  },
  "proxy": {
    "server": "http://proxy.corp.com:3128",
    "bypass": "localhost,.internal.com",
    "username": { "type": "literal", "value": "user" },
    "password": { "type": "env", "value": "PROXY_PASSWORD" },
    "ca_cert_path": "/path/to/target-ca.pem",
    "reject_unauthorized": false
  }
}
```

#### シークレットタイプ

| タイプ | ソース | 必要な CLI | 値の形式 |
|------|--------|-----------|---------|
| `literal` | インライン値 | なし | プレーンテキスト |
| `env` | プロセス環境変数 | なし | 変数名（例: `MY_TOKEN`） |
| `op` | 1Password | `op` | シークレット参照 URI（例: `op://vault/item/field`） |
| `aws_sm` | AWS Secrets Manager | `aws` | シークレット名または ARN |
| `gcp_sm` | GCP Secret Manager | `gcloud` | シークレット名 |
| `hcv` | HashiCorp Vault | `vault` | シークレットパス（例: `myapp/staging/db`） |

**`aws_sm` のエントリ単位オプション:**
- `region`（任意）— この secret 固有の AWS リージョン指定
- `json_key`（任意）— JSON 形式の secret から特定キーを抽出

**`gcp_sm` のエントリ単位オプション:**
- `project`（任意）— この secret 固有の GCP プロジェクト指定
- `version`（任意）— シークレットのバージョン。デフォルトは `latest`
- `json_key`（任意）— JSON 形式の secret から特定キーを抽出

**`hcv` のエントリ単位オプション:**
- `field`（任意）— KV シークレットから取得する特定フィールド
- `mount`（任意）— KV マウントポイント。デフォルトは `secret`

#### プロバイダー設定（`secret_providers`）

外部シークレットリゾルバのプロバイダーレベルのデフォルト設定。対応する type のすべての secret に適用されます。エントリ単位のオプションが優先されます。

| プロバイダー | キー | 説明 |
|------------|-----|------|
| `hcv` | `address` | Vault サーバー URL（環境変数 `VAULT_ADDR` に相当） |
| `hcv` | `namespace` | Vault namespace（Vault Enterprise 用） |
| `aws_sm` | `region` | 全 `aws_sm` secret のデフォルト AWS リージョン |
| `aws_sm` | `profile` | 使用する AWS named profile |
| `gcp_sm` | `project` | 全 `gcp_sm` secret のデフォルト GCP プロジェクト |

MCP サーバー経由での実行ではプロセス環境変数が利用できない場合があるため、この方法での設定を推奨します。

#### プロキシ設定

HTTP リクエストとブラウザアクセスをプロキシサーバー経由でルーティングします。環境ファイルに `proxy` セクションを追加してください:

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `server` | `string` | プロキシサーバー URL（例: `http://proxy:3128` や `https://proxy:3128`） |
| `bypass` | `string?` | プロキシをバイパスするドメイン（カンマ区切り） |
| `username` | `SecretEntry?` | プロキシ認証のユーザー名 |
| `password` | `SecretEntry?` | プロキシ認証のパスワード |
| `ca_cert_path` | `string?` | 接続先サーバーの TLS 用 CA 証明書ファイルパス（自己署名証明書、SSL インターセプトプロキシなど） |
| `proxy_ca_cert_path` | `string?` | プロキシサーバー自体の CA 証明書ファイルパス（HTTPS プロキシがカスタム CA を使用する場合） |
| `reject_unauthorized` | `boolean?` | `false` でプロキシと接続先の両方の証明書検証をスキップ |

**TLS オプションの適用方法:**

- **HTTP Driver**（undici ProxyAgent）: `ca_cert_path` → `requestTls.ca`、`proxy_ca_cert_path` → `proxyTls.ca`、`reject_unauthorized` → 両方に適用
- **Browser Driver**（Playwright/Chromium）: `reject_unauthorized: false` → `--ignore-certificate-errors` 起動フラグ + `ignoreHTTPSErrors` コンテキストオプション。カスタム CA ファイルはシステムのトラストストアへの追加が必要（Chromium の制限）

シークレットは実行時にローカルで解決されます。QA プランが `{{variable}}` テンプレートで実際に参照している secret のみが解決されるため、未使用の secret の CLI 認証は不要です。すべてのシークレット値はサーバー送信前にマスク（`***`）されます。

### 環境変数

| 変数 | 説明 |
|------|------|
| `AQUA_API_KEY` | 認証用 API キー。`~/.aqua/credentials.json` よりも優先。CI/CD 環境向け。 |
| `AQUA_SERVER_URL` | サーバー URL をオーバーライド |

## License

MIT
