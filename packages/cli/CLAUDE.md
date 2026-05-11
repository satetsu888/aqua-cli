# @aquaqa/cli

TypeScript で実装された CLI ツール兼 MCP Server。AI エージェントとの連携窓口であり、テスト実行エンジンを内蔵する。

## ディレクトリ構成

```text
src/
├── index.ts               # CLI エントリ (commander)
├── api/client.ts          # Backend HTTP クライアント
├── config/
│   ├── index.ts           # プロジェクト設定（.aqua/config.json）
│   └── credentials.ts     # サーバー認証情報（~/.aqua/credentials.json）
├── commands/              # CLI コマンド実装
│   ├── execute.ts         # execute コマンド + 共通実行ロジック（executeQAPlan）
│   └── record.ts          # record コマンド（ブラウザ操作記録）
├── setup/                 # セットアップ・認証フロー
│   ├── login.ts           # 認証（ブラウザ）+ ensureCredential
│   ├── init.ts            # プロジェクト設定（git remote から project_key を自動生成）
│   ├── prompts.ts         # readline ベースの対話プロンプト
│   └── git.ts             # git remote URL 検出・正規化・project_key 生成・ブランチ検出・PR URL 検出
├── mcp/                   # MCP Server・ツール定義
│   ├── server.ts
│   └── tools/
│       ├── qa-plan.ts     # QA Plan CRUD ツール（X-Project-Key ヘッダーで自動解決）
│       ├── execution.ts   # 実行ツール
│       ├── scenario.ts    # 単一シナリオ直接実行ツール（run_scenario）
│       ├── exploration.ts # インタラクティブ探索セッション
│       ├── exploration-log.ts # 探索ログ参照ツール
│       ├── common-scenario.ts # 共通シナリオ CRUD ツール
│       ├── environment.ts # 環境設定ツール
│       ├── memory.ts      # プロジェクトメモリツール
│       ├── setup.ts       # プロジェクトセットアップ状態確認ツール
│       └── recorder.ts    # ブラウザ操作記録ツール
├── driver/                # テスト実行ドライバー
│   ├── types.ts           # Driver インターフェース
│   ├── http.ts            # HTTP Driver (fetch + assertion)
│   ├── browser.ts         # Browser Driver (Playwright)
│   ├── proxy-bypass.ts    # プロキシ bypass パターンマッチング
│   ├── step-utils.ts      # ステップ実行共有ユーティリティ（依存順序解決・依存チェック・ブラウザ確認）
│   ├── executor.ts        # シナリオ実行エンジン（サーバー記録あり）
│   └── scenario-runner.ts # 単一シナリオ軽量実行（サーバー記録なし、run_scenario 用）
├── exploration/           # 探索セッションログの永続化
│   └── log.ts             # ログの読み書き・クリーンアップ（~/.aqua/explorations/）
├── recorder/              # ブラウザ操作記録（Playwright codegen 連携）
│   ├── recorder.ts        # codegen サブプロセスの起動・管理
│   └── codegen-parser.ts  # codegen JS 出力 → BrowserStep[] パーサー
├── environment/           # 環境設定の読み込み・解決
│   ├── types.ts           # EnvironmentFile 型定義 + zod スキーマ
│   ├── loader.ts          # ファイル読み込み・secrets 解決・バリデーション
│   ├── secret-cache.ts    # 外部シークレットのオンメモリキャッシュ（MCP起動時に事前解決）
│   ├── resolver-registry.ts # ExternalSecretResolver インターフェース + レジストリ
│   ├── op-resolver.ts     # 1Password CLI (op) 連携
│   ├── aws-sm-resolver.ts # AWS Secrets Manager 連携
│   ├── gcp-sm-resolver.ts # GCP Secret Manager 連携
│   ├── hcv-resolver.ts    # HashiCorp Vault 連携
│   └── index.ts
├── masking/               # サーバー送信前のシークレットマスキング
│   ├── types.ts           # MaskRule インターフェース
│   ├── rules.ts           # 各マスクルール実装
│   ├── masker.ts          # ルール統括
│   └── index.ts
├── plugin/                # プラグインシステム
│   ├── interface.ts       # AquaPlugin インターフェース + 型エクスポート
│   ├── registry.ts        # PluginRegistry（登録・ドライバーキャッシュ）
│   ├── loader.ts          # .aqua/config.json からプラグインを dynamic import
│   ├── utils.ts           # 共有ユーティリティ（getJsonPath, extractValues）
│   └── index.ts
├── qa-plan/
│   └── types.ts           # Step/Assertion/Config の Zod スキーマ + 型定義
└── utils/
    ├── template.ts        # {{variable}} / {{totp:variable}} テンプレート展開
    └── totp.ts            # TOTP ワンタイムパスワード計算（otpauth）
```

## 技術スタック

- @modelcontextprotocol/sdk - MCP Server
- commander - CLI フレームワーク
- playwright - ブラウザ自動操作
- zod - バリデーション
- otpauth - TOTP ワンタイムパスワード計算
- undici - HTTP プロキシ（ProxyAgent）
- tsup - バンドル（playwright, undici 等は external 指定。ESM 出力のため `require()` は使用不可、必ず ESM import を使うこと）

## CLI コマンド

- `aqua-cli login` - サーバーにブラウザ認証。`~/.aqua/credentials.json` に保存
- `aqua-cli logout` - 保存された認証情報を削除
- `aqua-cli whoami` - 認証中のユーザー情報を表示（ID, Email, 表示名）
- `aqua-cli init` - プロジェクト設定（git remote から `project_key` を自動生成）。`.aqua/config.json` に `server_url` と `project_key` を保存。事前に `aqua-cli login` が必要
- `aqua-cli execute <qa_plan_id>` - QA Plan を直接実行。MCP を通さずにテスト実行可能。`--env <name>` で環境指定（省略時はインタラクティブ選択）、`--plan-version <n>` でバージョン指定、`--var key=value` で変数オーバーライド（複数可）。実行開始直後に Web UI の URL を表示し、結果はシナリオ単位の階層構造で出力
- `aqua-cli record [url]` - Playwright codegen でブラウザ操作を記録。ブラウザが開き、ユーザーが操作。ブラウザを閉じると BrowserStep[] の JSON を stdout に出力。ログイン不要
- `aqua-cli plugin add <package>` - プラグインをインストールし `.aqua/config.json` に追加
- `aqua-cli plugin remove <package>` - プラグインを `.aqua/config.json` から削除しアンインストール
- `aqua-cli plugin list` - 設定済みプラグインの一覧表示
- `aqua-cli mcp-server` - MCP サーバーを起動。事前に `aqua-cli login` が必要

### 認証フロー

- `aqua-cli login` でブラウザ認証を行う
- `AQUA_API_KEY` 環境変数でも認証可能（CI/CD 環境向け。`~/.aqua/credentials.json` より優先される）
- `aqua-cli init` / `aqua-cli mcp-server` は事前ログインまたは `AQUA_API_KEY` 環境変数が必要（いずれもない場合はエラー）
- 認証情報はユーザーレベル（`~/.aqua/credentials.json`）、プロジェクト設定はプロジェクトレベル（`.aqua/config.json`）

### プロジェクト識別

- `.aqua/config.json` に `project_key`（正規化されたリポジトリ URL、例: `github.com/owner/repo`）を保存
- git remote がない場合は `local/<ディレクトリ名>-<ランダム>` 形式の project_key を生成
- `AquaClient` が全リクエストに `X-Project-Key` ヘッダーを付与し、サーバー側でプロジェクトを自動解決
- MCP サーバー起動時に `resolveProject()` を呼んでプロジェクトの存在を確認（なければ自動作成）。ただし `project_key` 未設定でも全ツールが登録される（サーバー通信が必要なツールは実行時にエラー）
- **Soft Quota**: 実行前に `GET /api/quota/status` でクォータ状態（ストレージ）をプリチェックし、超過時はサーバーへのデータ記録を全スキップしてテストをローカル実行（警告表示のみ）。テスト自体は常に実行可能。プリチェック失敗時はフォールバックで通常記録を試み、サーバーの 402 がセーフティネットとなる

## MCP ツール一覧

### QA Plan ツール

- `create_qa_plan` - QA Plan 作成（プロジェクトは `X-Project-Key` ヘッダーで自動解決）。`git_branch` と `pull_request_url` を任意で指定可能（未指定時は `git rev-parse` / `gh pr view` で自動検出）
- `get_qa_plan` - QA Plan 取得
- `list_qa_plans` - QA Plan 一覧（プロジェクトは `X-Project-Key` ヘッダーで自動解決）。`pinned` パラメータでピン留めフィルタ可能。カーソルベースページネーション（`limit` / `cursor` パラメータ、`{ items, next_cursor }` レスポンス）
- `update_qa_plan` - QA Plan 更新（シナリオ・ステップの構造化データで新バージョン作成）。`name` は任意（バージョン番号はシステム自動管理）
- `update_qa_plan_step` - 単一ステップの部分更新（新バージョンを作成。name はパッチ内容から自動生成）
- `add_qa_plan_step` - シナリオにステップを追加（新バージョンを作成。name はパッチ内容から自動生成）
- `remove_qa_plan_step` - ステップを削除（新バージョンを作成。name はパッチ内容から自動生成）
- `set_qa_plan_status` - QA Plan ステータス変更
- `pin_qa_plan` - QA Plan ピン留め/解除。`list_qa_plans` の `pinned` フィルタで素早くアクセス可能

### Execution ツール

- `execute_qa_plan` - QA Plan を実行（全シナリオを順次実行し結果を記録。`env_name` で環境選択可能。レスポンスにはマスク済み resolved variables と Web UI の実行結果 URL を含む。`async=true` でバックグラウンド実行可能、`get_execution_progress` でポーリング。MCP Progress Notification にも対応）
- `get_execution_progress` - 実行中の Execution の進捗をステップ単位で取得（完了済みステップ・現在実行中のステップ・統計情報）
- `run_scenario` - 単一シナリオを直接実行（サーバー記録なし、インラインでシナリオ config を指定）。`qa_plan_id` でプラン変数を継承可能。HTTP レスポンスボディ等の詳細をレスポンスに含む。ブラウザスクリーンショットは MCP image content としてインライン返却（ファイル保存なし）
- `get_execution` - 実行結果取得（ステップ詳細含む）
- `list_executions` - 実行一覧（`qa_plan_id` / `qa_plan_version_id` / `status` でフィルタ可能）。カーソルベースページネーション

### Environment ツール

- `create_environment` - 環境設定ファイルを作成（`.aqua/environments/<name>.json`）。`notes` で環境固有のメモ（前提条件・制約等）を記録可能
- `list_environments` - `.aqua/environments/` 内の利用可能な環境一覧（各環境の notes も表示）
- `validate_environment` - 環境設定ファイルの検証（スキーマ・環境変数チェック）

### Common Scenario ツール

- `create_common_scenario` - 再利用可能な共通シナリオテンプレートを作成（name, description, requires, steps）
- `get_common_scenario` - ID で共通シナリオを取得
- `list_common_scenarios` - プロジェクト内の共通シナリオ一覧
- `update_common_scenario` - 共通シナリオを更新（部分更新可能）
- `delete_common_scenario` - 共通シナリオを削除（コピー済み QAPlan には影響なし）

### Memory ツール

- `get_project_memory` - プロジェクトメモリを取得（未設定時はテンプレートを返却）
- `save_project_memory` - プロジェクトメモリを保存（全体上書き）

### Exploration ツール

- `start_exploration` - インタラクティブ探索セッションを開始。`env_name` / `environment` / `qa_plan_id` で変数を事前ロード可能。セッションは15分無操作でタイムアウト。アクションは `~/.aqua/explorations/` に自動保存
- `explore_action` - セッション内でアクションを実行。`browser_step`（単一）、`browser_steps`（一括リプレイ）、`http_request`、`browser_assertion` のいずれか
- `end_exploration` - 探索セッションを終了しリソースを解放
- `list_exploration_logs` - 最近の探索セッションログ一覧を取得
- `get_exploration_log` - 特定セッションの全アクションログを取得。成功したステップを `browser_steps` でリプレイ可能

### Recorder ツール

- `record_browser_actions` - Playwright codegen を使ってブラウザ操作を記録。BrowserStep[] を返す

### Setup ツール

- `check_project_setup` - プロジェクトのセットアップ状態を一括確認（Local Configuration / Project Memory / Environments / Common Scenarios）

## テスト実行エンジン

### Driver アーキテクチャ

`executor.ts`（サーバー記録あり）と `scenario-runner.ts`（サーバー記録なし）が `step-utils.ts` の共有ユーティリティ（`resolveStepOrder`, `checkStepDependencies`, `checkBrowserDependencies`）を使ってシナリオ実行を統括し、各ステップの `action` に応じて適切な Driver を呼び出す:

- **HTTP Driver** (`http.ts`) - `http_request` アクション。fetch でリクエストし、レスポンスに対してアサーションを実行。`poll` オプションで HTTP ポーリングにも対応。あらゆる Content-Type の送受信に対応(後述「HTTP body 形式」)
- **Browser Driver** (`browser.ts`) - `browser` アクション。Playwright でブラウザ操作。デフォルトタイムアウト10秒（`timeout_ms` でステップ単位で変更可能）。`goto` 失敗時はシナリオ内の残りステップを自動スキップ。`switch_to_frame` / `switch_to_main_frame` で iframe 切り替え対応

### HTTP body 形式

リクエスト body は `RequestBodySchema`（discriminated union）で表現:

- `{ type: "json", value: ... }` - JSON 直列化
- `{ type: "form", fields: {...} }` - `application/x-www-form-urlencoded`
- `{ type: "multipart", boundary?, fields?, files? }` - `multipart/form-data`(files は `path` / `content` / `content_base64` を1つ指定)
- `{ type: "text", value: "..." }` - 任意のテキスト(XML/SOAP 等)
- `{ type: "binary", path? | content_base64? }` - 生バイナリ
- `{ type: "graphql", query, variables?, operationName? }` - GraphQL

**ヘッダーは自動付与しない**: ランナーはユーザーが `headers` に書いたものをそのまま送る。`Content-Type` も例外なし。これによりネガティブテスト(意図的なヘッダー/body 不一致)や、ベンダー固有 MIME(`application/vnd.api+json` 等)が表現可能。

**後方互換**: 旧形式の `body`(plain object / string)は `normalizeBody` で自動的に `{ type: "json", ... }` / `{ type: "text", ... }` に正規化される。

レスポンス側は `Content-Type` で text/binary を自動判定。`HttpRequestConfigSchema.response_body: "auto" | "text" | "binary"` で明示オーバーライド可。`max_response_body_size`(既定 50MB)でストリーミング読み込みのサイズキャップ。`HttpResponse` は `body`(テキスト時のみ)、`body_bytes`(バイナリ時のみ)、`body_size`、`body_sha256`、`body_truncated?`、`content_type?`、`is_binary` を持つ。バイナリレスポンスはアーティファクトとして `http_response.json`(要約) + `http_response_body`(生バイト)に分割記録される。

### アサーション型

`qa-plan/types.ts` で Zod スキーマとして定義し、`z.infer<>` で TypeScript 型を導出（single source of truth）。全アサーションに任意の `description` フィールドあり。

**HTTP アサーション**: `status_code`, `status_code_in`, `json_path`(equals / exists / not_exists / contains), `header`(equals / contains / exists / not_exists / matches。大文字小文字を区別しない), `body_size`(equals / greater_than / less_than / between), `body_hash`(sha256 / md5。golden file 比較に使う), `body_contains`(テキスト body 部分一致。バイナリでは常に fail)

**ブラウザアサーション**: `element_text`, `element_visible`, `element_not_visible`, `url_contains`, `title`, `screenshot`, `element_count`, `element_attribute`, `cookie_exists`, `cookie_value`, `localstorage_exists`, `localstorage_value`

### Step Config 型

`action` による discriminated union で config を型付け:
- `HttpRequestConfigSchema` - method, url, headers, body(`RequestBodySchema`), timeout, poll, response_body, max_response_body_size
- `BrowserConfigSchema` - steps（19種のブラウザアクション）, timeout_ms
- `StepConditionSchema` - `variable_equals` / `variable_not_equals` で条件付き実行

### シナリオ実行の仕組み

- **requires**: シナリオに必要な変数名を指定。不足時はシナリオ全体をスキップ
- **condition**: ステップ単位の条件付き実行（`extract` 変数に基づく）
- **depends_on**: シナリオを超えてステップ依存を指定可能
- **extract 変数**: グローバル共有。後続シナリオで `{{variable}}` として利用可能
- **ブラウザ storageState**: シナリオ間で Cookie/localStorage を自動引き継ぎ
- **テンプレート展開**: `{{variable}}` / `{{totp:variable}}`（2FA 自動化）

## 環境設定

`.aqua/environments/<name>.json` に環境ごとの変数・シークレットを定義。

```jsonc
{
  "notes": "環境固有のメモ（Markdown）",
  "variables": { "api_base_url": "...", "web_base_url": "..." },
  "secrets": {
    "api_key": { "type": "literal", "value": "..." },
    "auth_token": { "type": "env", "value": "ENV_VAR_NAME" },
    "db_password": { "type": "op", "value": "op://..." },
    "aws_secret": { "type": "aws_sm", "value": "secret-name", "region": "...", "json_key": "..." },
    "gcp_secret": { "type": "gcp_sm", "value": "secret-name", "project": "..." },
    "vault_secret": { "type": "hcv", "value": "path", "field": "..." }
  },
  "secret_providers": { ... },
  "proxy": { "server": "...", "bypass": "...", ... }
}
```

- Secret type: `literal`, `env`, `op`（1Password）, `aws_sm`, `gcp_sm`, `hcv`（HashiCorp Vault）
- 変数優先順位: QA Plan variables < environment file < execute_qa_plan 引数
- secrets の解決はプランが参照する変数のみに限定（静的解析で最適化）
- シークレットキャッシュ: MCP サーバー起動時に外部シークレットを事前解決してキャッシュ
- Environment Resolution: レイヤーモデル（`plan` / `environment` / `override`）で出処を追跡

## マスキング

サーバー送信前にシークレットをマスクするルールベースシステム:
- SecretKeysRule, HttpAuthHeaderRule, HttpSetCookieRule, DomPasswordRule, SecretValueScanRule
- `MaskRule` インターフェースを実装して `Masker` に登録すればルール追加が可能

## プラグインシステム

built-in の `http_request` / `browser` 以外のアクション型をプラグインとして追加可能。

### AquaPlugin インターフェース

プラグインは `AquaPlugin` インターフェースを実装した default export を持つ npm パッケージ:

```typescript
import type { AquaPlugin } from "@aquaqa/cli/plugin";

const myPlugin: AquaPlugin = {
  name: "@aquaqa/my-plugin",
  actionType: "my_action",           // step.action に指定する名前
  configSchema: MyConfigSchema,       // Zod スキーマ（MCP ツール説明に使用）
  assertionSchemas: [MyAssertionSchema],
  actionDescription: "説明テキスト",
  async createDriver(variables) {     // Driver インスタンスを生成
    return new MyDriver(variables.api_key);
  },
};
export default myPlugin;
```

### プラグインの設定

`.aqua/config.json` の `plugins` 配列にパッケージ名を追加:
```jsonc
{ "plugins": ["@aquaqa/stripe-plugin"] }
```

### 実行フロー

1. MCP サーバー起動時に `loadPlugins()` で `.aqua/config.json` からプラグインを dynamic import
2. `PluginRegistry` に登録
3. ステップ実行時、built-in アクションに一致しない場合は `PluginRegistry` からドライバーを取得して実行
4. ドライバーはシナリオ単位でキャッシュ（シナリオ終了時に `clearDriverCache()`）
5. MCP instructions にプラグインアクション説明を動的追記

### エクスポート

プラグイン開発者向けに以下のサブパスをエクスポート:
- `@aquaqa/cli/plugin` — `AquaPlugin`, `Driver`, `Step`, `StepResult`, `AssertionResultData` 型
- `@aquaqa/cli/utils` — `getJsonPath()`, `extractValues()` ユーティリティ
