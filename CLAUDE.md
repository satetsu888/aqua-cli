# aqua - CLI / MCP Server

TypeScript で実装された CLI ツール兼 MCP Server。AI エージェントとの連携窓口であり、テスト実行エンジンを内蔵する。

## ディレクトリ構成

```text
cli/
├── src/
│   ├── index.ts               # CLI エントリ (commander)
│   ├── api/client.ts          # Backend HTTP クライアント
│   ├── config/
│   │   ├── index.ts           # プロジェクト設定（.aqua/config.json）
│   │   └── credentials.ts     # サーバー認証情報（~/.aqua/credentials.json）
│   ├── commands/              # CLI コマンド実装
│   │   ├── execute.ts         # execute コマンド + 共通実行ロジック（executeQAPlan）
│   │   └── record.ts          # record コマンド（ブラウザ操作記録）
│   ├── setup/                 # セットアップ・認証フロー
│   │   ├── login.ts           # 認証（ブラウザ）+ ensureCredential
│   │   ├── init.ts            # プロジェクト設定（git remote から project_key を自動生成）
│   │   ├── prompts.ts         # readline ベースの対話プロンプト
│   │   └── git.ts             # git remote URL 検出・正規化・project_key 生成・ブランチ検出・PR URL 検出
│   ├── mcp/                   # MCP Server・ツール定義
│   │   ├── server.ts
│   │   └── tools/
│   │       ├── qa-plan.ts     # QA Plan CRUD ツール（X-Project-Key ヘッダーで自動解決）
│   │       ├── execution.ts   # 実行ツール
│   │       ├── scenario.ts    # 単一シナリオ直接実行ツール（run_scenario）
│   │       ├── exploration.ts # インタラクティブ探索セッション（start_exploration, explore_action, end_exploration）
│   │       ├── exploration-log.ts # 探索ログ参照ツール（list_exploration_logs, get_exploration_log）
│   │       ├── common-scenario.ts # 共通シナリオ CRUD ツール
│   │       ├── environment.ts # 環境設定ツール
│   │       ├── memory.ts      # プロジェクトメモリツール
│   │       ├── setup.ts       # プロジェクトセットアップ状態確認ツール（check_project_setup）
│   │       └── recorder.ts    # ブラウザ操作記録ツール（record_browser_actions）
│   ├── driver/                # テスト実行ドライバー
│   │   ├── types.ts           # Driver インターフェース
│   │   ├── http.ts            # HTTP Driver (fetch + assertion)
│   │   ├── browser.ts         # Browser Driver (Playwright)
│   │   ├── proxy-bypass.ts    # プロキシ bypass パターンマッチング（HTTP Driver 用）
│   │   ├── step-utils.ts      # ステップ実行共有ユーティリティ（依存順序解決・依存チェック・ブラウザ確認）
│   │   ├── executor.ts        # シナリオ実行エンジン（サーバー記録あり）
│   │   └── scenario-runner.ts # 単一シナリオ軽量実行（サーバー記録なし、run_scenario 用）
│   ├── exploration/           # 探索セッションログの永続化
│   │   └── log.ts             # ログの読み書き・クリーンアップ（~/.aqua/explorations/）
│   ├── recorder/              # ブラウザ操作記録（Playwright codegen 連携）
│   │   ├── recorder.ts        # codegen サブプロセスの起動・管理
│   │   └── codegen-parser.ts  # codegen JS 出力 → BrowserStep[] パーサー
│   ├── environment/           # 環境設定の読み込み・解決
│   │   ├── types.ts           # EnvironmentFile 型定義 + zod スキーマ
│   │   ├── loader.ts          # ファイル読み込み・secrets 解決・バリデーション
│   │   ├── secret-cache.ts    # 外部シークレットのオンメモリキャッシュ（MCP起動時に事前解決）
│   │   ├── resolver-registry.ts # ExternalSecretResolver インターフェース + レジストリ
│   │   ├── op-resolver.ts     # 1Password CLI (op) 連携
│   │   ├── aws-sm-resolver.ts # AWS Secrets Manager 連携
│   │   ├── gcp-sm-resolver.ts # GCP Secret Manager 連携
│   │   ├── hcv-resolver.ts    # HashiCorp Vault 連携
│   │   └── index.ts
│   ├── masking/               # サーバー送信前のシークレットマスキング
│   │   ├── types.ts           # MaskRule インターフェース
│   │   ├── rules.ts           # 各マスクルール実装
│   │   ├── masker.ts          # ルール統括
│   │   └── index.ts
│   ├── qa-plan/
│   │   └── types.ts           # Step/Assertion/Config の Zod スキーマ + 型定義
│   └── utils/
│       ├── template.ts        # {{variable}} / {{totp:variable}} テンプレート展開
│       └── totp.ts            # TOTP ワンタイムパスワード計算（otpauth）
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## 技術スタック

- @modelcontextprotocol/sdk - MCP Server
- commander - CLI フレームワーク
- playwright - ブラウザ自動操作
- zod - バリデーション
- otpauth - TOTP ワンタイムパスワード計算
- undici - HTTP プロキシ（ProxyAgent）
- tsup - バンドル（playwright, undici 等は external 指定。ESM 出力のため `require()` は使用不可、必ず ESM import を使うこと）

## 開発コマンド

```bash
npm run build          # tsup ビルド
npm test               # vitest run（全テスト実行）
npx tsc --noEmit       # 型チェック
```

## テスト

Vitest を使用。全テストはユニットテストで、外部依存はすべてモック化されている。

### ファイル配置・命名

ソースファイルと同じディレクトリに `*.test.ts` で配置（co-located）。共有テストヘルパーディレクトリはなく、各テストファイル内にファクトリ関数やモックヘルパーを定義する。

### 設定

`vitest.config.ts` で `globals: true`、`environment: "node"` を指定。`tsconfig.json` の `types` に `vitest/globals` を含む。

### テスト構造

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
```

- `describe` でテスト対象の関数・クラス単位にグルーピング。ネスト可
- `beforeEach` でモックを `.mockReset()` してテスト間の分離を確保
- `it` の記述は `"returns X when Y"` / `"creates X with Y"` のような結果ベースの命名

### モックパターン

**モジュールモック（`vi.mock()`）** - ファイルトップレベルで宣言。対象モジュールの関数を `vi.fn()` で差し替え:

```typescript
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));
```

**グローバルモック（`vi.stubGlobal()`）** - `fetch` などグローバル関数の差し替え:

```typescript
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
```

**型付きモック呼び出し** - `vi.mocked()` でモック関数として型安全にアクセス:

```typescript
vi.mocked(fs.existsSync).mockReturnValue(true);
```

### ファクトリ関数パターン

テストデータ生成にはテストファイル内にファクトリ関数を定義し、`overrides` で部分上書きできるようにする:

```typescript
function httpStep(overrides: Partial<Step> = {}): Step {
  return {
    id: "server-id-1",
    step_key: "test-step",
    action: "http_request",
    config: { method: "GET", url: "http://example.com/api" },
    sort_order: 0,
    ...overrides,
  } as Step;
}
```

### MCP ツールのテストパターン

`createMockServer()` でツール登録をキャプチャし、`getHandler(name)` でハンドラを取得してテスト:

```typescript
function createMockServer() {
  const tools = new Map<string, ToolCallback>();
  return {
    tool: vi.fn((name, _desc, _schema, handler) => {
      tools.set(name, handler);
    }),
    getHandler: (name: string) => tools.get(name)!,
  };
}
```

## CLI コマンド

- `aqua-cli login` - サーバーにブラウザ認証。`~/.aqua/credentials.json` に保存
- `aqua-cli logout` - 保存された認証情報を削除
- `aqua-cli whoami` - 認証中のユーザー情報を表示（ID, Email, 表示名）
- `aqua-cli init` - プロジェクト設定（git remote から `project_key` を自動生成）。`.aqua/config.json` に `server_url` と `project_key` を保存。事前に `aqua-cli login` が必要
- `aqua-cli execute <qa_plan_id>` - QA Plan を直接実行。MCP を通さずにテスト実行可能。`--env <name>` で環境指定（省略時はインタラクティブ選択）、`--plan-version <n>` でバージョン指定、`--var key=value` で変数オーバーライド（複数可）。実行開始直後に Web UI の URL を表示し、結果はシナリオ単位の階層構造で出力
- `aqua-cli record [url]` - Playwright codegen でブラウザ操作を記録。ブラウザが開き、ユーザーが操作。ブラウザを閉じると BrowserStep[] の JSON を stdout に出力。ログイン不要
- `aqua-cli mcp-server` - MCP サーバーを起動。事前に `aqua-cli login` が必要

### 認証フロー

- `aqua-cli login` でブラウザ認証を行う
- `aqua-cli init` / `aqua-cli mcp-server` は事前ログインが必要（未ログイン時はエラー）
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
- `list_executions` - 実行一覧（`qa_plan_id` / `qa_plan_version_id` / `status` でフィルタ可能）。カーソルベースページネーション（`limit` / `cursor` パラメータ、`{ items, next_cursor }` レスポンス）

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

- `get_project_memory` - プロジェクトメモリを取得（未設定時はテンプレートを返却）。QA プラン作成・実行を通じて蓄積された知識（アプリ構造、認証フロー、有効なセレクタ等）を確認
- `save_project_memory` - プロジェクトメモリを保存（全体上書き）。実行で学んだ知見を記録

### Exploration ツール

- `start_exploration` - インタラクティブ探索セッションを開始。ページ構造やセレクタが不明な段階で、1アクションずつ実行して結果を確認しながら調査するために使用。`env_name` / `environment` / `qa_plan_id` で変数を事前ロード可能。セッションは15分無操作でタイムアウト。セッション中のアクションは `~/.aqua/explorations/` に自動保存される
- `explore_action` - セッション内でアクションを実行。`browser_step`（単一ブラウザ操作→DOM全体+screenshot+URL+title を返却）、`browser_steps`（複数ブラウザ操作を一括実行→最終状態のみ返却、過去の探索ログからのリプレイに使用）、`http_request`（HTTPリクエスト→status+headers+body を返却、`extract` で値抽出可能）、`browser_assertion`（アサーション評価）のいずれかを指定。ブラウザはセッション間で起動したまま維持
- `end_exploration` - 探索セッションを終了しリソースを解放
- `list_exploration_logs` - 最近の探索セッションログ一覧を取得。各セッションのアクション数・成功数・最終URLを表示
- `get_exploration_log` - 特定セッションの全アクションログを取得。成功したブラウザステップの一覧も含まれ、`browser_steps` パラメータにそのまま渡してリプレイ可能

### Recorder ツール

- `record_browser_actions` - Playwright codegen を使ってブラウザ操作を記録。ブラウザが開きユーザーが操作、閉じると BrowserStep[] を返す。返された steps は `update_qa_plan` / `create_common_scenario` / `run_scenario` にそのまま使用可能。セレクタは Playwright が自動生成（role=, text=, CSS 等）

### Setup ツール

- `check_project_setup` - プロジェクトのセットアップ状態を一括確認（Local Configuration / Project Memory / Environments / Common Scenarios）。`aqua-cli init` 未実施ならその旨を表示し、project_key 未設定時はサーバーチェック（Memory / Common Scenarios）をスキップ

## テスト実行エンジン

### Driver アーキテクチャ

`executor.ts`（サーバー記録あり）と `scenario-runner.ts`（サーバー記録なし）が `step-utils.ts` の共有ユーティリティ（`resolveStepOrder`, `checkStepDependencies`, `checkBrowserDependencies`）を使ってシナリオ実行を統括し、各ステップの `action` に応じて適切な Driver を呼び出す:

- **HTTP Driver** (`http.ts`) - `http_request` アクション。fetch でリクエストし、レスポンスに対してアサーションを実行。`poll` オプションで HTTP ポーリングにも対応（`poll.until` で終了条件、`poll.interval_ms` / `poll.timeout_ms` で間隔・タイムアウトを指定）
- **Browser Driver** (`browser.ts`) - `browser` アクション。Playwright でブラウザ操作（goto, click, type, hover, select_option, check/uncheck, press, screenshot, wait_for_selector, wait_for_url, double_click, focus, upload_file, set_header, switch_to_frame, switch_to_main_frame）。デフォルトタイムアウト10秒（`timeout_ms` でステップ単位で変更可能）。`goto` 失敗時はナビゲーションエラーとしてシナリオ内の残りステップを自動スキップ（`abortScenario` フラグ）。`switch_to_frame` で iframe 内に切り替え、`switch_to_main_frame` でトップレベルに戻る。フレーム切り替え後は既存の全アクション・アサーションがフレーム内で動作する

### アサーション型

`qa-plan/types.ts` で Zod スキーマとして定義し、`z.infer<>` で TypeScript 型を導出（single source of truth）。

全アサーションタイプに任意の `description` フィールド（`string | undefined`）があり、アサーションの目的・意図を記述可能（例: `"ユーザー情報が正常に返ること"`）。サーバー側で `step_assertions` テーブルに正規化して保存される。CLI は実行結果に `step_assertion_id` を含めて送信し、サーバーが description を enrichment して返す。

**HTTP アサーション** (`HttpAssertion`):
- `status_code` - ステータスコード完全一致（`{ type: "status_code", expected: 200, description: "..." }`）
- `status_code_in` - ステータスコード複数値マッチ（`{ type: "status_code_in", expected: [200, 201, 409] }`）
- `json_path` - JSONPath でレスポンスボディを検証（equals / exists / not_exists / contains）

**ブラウザアサーション** (`BrowserAssertion`):
- `element_text` - 要素テキストの存在・部分一致
- `element_visible` - 要素の表示確認
- `element_not_visible` - 要素が非表示であることの確認
- `url_contains` - URL の部分一致
- `title` - ページタイトル完全一致
- `screenshot` - スクリーンショット取得（常に pass）
- `element_count` - セレクタにマッチする要素数の検証
- `element_attribute` - 要素の属性値の検証
- `cookie_exists` - 指定名の cookie が存在するか確認
- `cookie_value` - cookie の値を検証（exact/contains）
- `localstorage_exists` - localStorage キーの存在確認
- `localstorage_value` - localStorage の値を検証（exact/contains）

### Step Config 型

同じく `qa-plan/types.ts` で Zod スキーマ定義。MCP の StepSchema は `action` による discriminated union で config を型付けしている。

- `HttpRequestConfigSchema` - method, url, headers, body, timeout
- `BrowserConfigSchema` - steps（goto, click, double_click, type, hover, select_option, check, uncheck, press, focus, wait_for_selector, wait_for_url, screenshot, set_header, upload_file の配列）, timeout_ms（ステップ全体のタイムアウト、デフォルト10秒）
- `PollConfigSchema` - until（終了条件: status_code / json_path）, interval_ms, timeout_ms。`HttpRequestConfigSchema` の `poll` フィールドとして使用
- `StepConditionSchema` - ステップの条件付き実行。`variable_equals`（変数が特定値と一致）/ `variable_not_equals`（変数が特定値と不一致）の2種類。ステップの `condition` フィールドとして使用

ブラウザコンテキストはシナリオ単位で作成され、同一シナリオ内のステップ間でセッションが維持される。シナリオ間では Playwright の `storageState` により Cookie/localStorage が自動的に引き継がれる。

### シナリオの条件付き実行

- **requires**: シナリオに `requires: ["db_url", "db_password"]` のように必要な変数名を指定可能。実行時に指定された変数が環境に存在しない場合、シナリオ全体をスキップ（全ステップが `status: "skipped"` で記録される）。環境ごとに利用可能な変数が異なるケース（例: ローカルでは DB 接続可能だが production では不可）に対応

### ステップの条件付き実行

- **condition**: ステップに `condition` フィールドで条件付き実行を指定可能。前ステップの `extract` で取得した変数値に基づいてステップの実行を制御する。条件不一致時はステップをスキップ。独立した前準備ステップ等で使用
  - `variable_equals` - 変数が特定の値と一致する場合のみ実行（`{ type: "variable_equals", variable: "status", value: "active" }`）
  - `variable_not_equals` - 変数が特定の値と一致しない場合のみ実行（`{ type: "variable_not_equals", variable: "status", value: "active" }`）

### シナリオ横断の状態共有

- **depends_on**: シナリオを超えてステップIDを参照可能。前シナリオのステップが passed であれば依存解決される
- **extract 変数**: `extract` で取得した値はグローバルに共有され、後続シナリオで `{{variable}}` として利用可能。`requires` のチェックは extract 後の変数に対して行われるため、前シナリオで extract した変数を後続シナリオの requires に指定可能
- **ブラウザ storageState**: シナリオ終了時に Cookie/localStorage を保存し、次シナリオのブラウザ起動時に復元。ログイン操作を1回行えば後続シナリオでも認証状態が維持される

### テンプレート展開

QA Plan 内の `{{variable}}` は実行時の environment で展開される（`utils/template.ts`）。

- `{{variable}}` - variables マップから値を取得して展開
- `{{totp:variable}}` - variables マップから TOTP シークレット（Base32）を取得し、OTP コード（6桁）を計算して展開。2FA ログインフローの自動化に利用
- `collectVariableReferences(obj)` - オブジェクトツリーを走査して参照されている変数名を `Set<string>` で返す。実行時に必要な secrets だけを解決するために使用

## 環境設定

プロジェクトの `.aqua/environments/<name>.json` に環境ごとの変数・シークレットを定義する。

```jsonc
// .aqua/environments/staging.json
{
  "notes": "- VPN 接続が必要\n- テストアカウント: test@example.com",
  "variables": { "api_base_url": "https://staging-api.example.com", "web_base_url": "https://staging.example.com" },
  "secrets": {
    "api_key": { "type": "literal", "value": "dev-key-123" },
    "auth_token": { "type": "env", "value": "STAGING_AUTH_TOKEN" },
    "db_password": { "type": "op", "value": "op://Development/staging-db/password" },
    "aws_secret": { "type": "aws_sm", "value": "staging/db-credentials", "region": "ap-northeast-1", "json_key": "password" },
    "gcp_secret": { "type": "gcp_sm", "value": "staging-api-key", "project": "my-project-123" },
    "vault_secret": { "type": "hcv", "value": "myapp/staging/keys", "field": "signing_key" }
  },
  "secret_providers": {
    "hcv": { "address": "https://vault.example.com:8200", "namespace": "staging" },
    "aws_sm": { "region": "ap-northeast-1", "profile": "staging" },
    "gcp_sm": { "project": "my-project-123" }
  },
  "proxy": {
    "server": "http://proxy.corp.com:3128",
    "bypass": "localhost,.internal.com",
    "username": { "type": "literal", "value": "user" },
    "password": { "type": "env", "value": "PROXY_PASSWORD" },
    "ca_cert_path": "/path/to/target-ca.pem",
    "proxy_ca_cert_path": "/path/to/proxy-ca.pem",
    "reject_unauthorized": false
  }
}
```

- `notes`: 環境固有のメモ（Markdown）。前提条件、制約、テストアカウント、認証手順等を記録。`list_environments` の出力に表示され、AI エージェントが QA Plan 設計前に環境の特性を把握できる
- `variables`: そのまま使う通常の変数。URL は `api_base_url`（API 用）と `web_base_url`（ブラウザ用）で使い分ける
- `secrets`: `type` で値の解決方法を指定。外部リゾルバは `ExternalSecretResolver` インターフェースで統一管理（`resolver-registry.ts`）
  - `literal` = そのまま、`env` = 環境変数から取得
  - `op` = 1Password CLI（`op read <reference>`）
  - `aws_sm` = AWS Secrets Manager（`aws secretsmanager get-secret-value`）。`region`（optional）、`json_key`（optional: JSON シークレットから特定キーを抽出）
  - `gcp_sm` = GCP Secret Manager（`gcloud secrets versions access`）。`project`（optional）、`version`（optional、デフォルト "latest"）、`json_key`（optional）
  - `hcv` = HashiCorp Vault（`vault kv get`）。`field`（optional: 特定フィールドを取得）、`mount`（optional、デフォルト "secret"）
- `secret_providers`: 外部リゾルバのプロバイダーレベル設定。各 type のデフォルトを環境単位で定義（`hcv.address`, `aws_sm.region`/`aws_sm.profile`, `gcp_sm.project` 等）。エントリレベルのフィールドが優先。プロセス環境変数（`VAULT_ADDR` 等）へのフォールバックもあるが、MCP サーバー経由では `secret_providers` で設定するのが推奨
- 外部 CLI ベースの type（`op`, `aws_sm`, `gcp_sm`, `hcv`）がある場合、実行前に CLI の存在を自動チェックする
- secrets の解決はプランが参照する変数のみに限定される（`collectVariableReferences` でプランを静的解析し、`loadEnvironment` / `resolveEnvironment` の `requiredKeys` パラメータでフィルタ）。プランが使わない外部 type の secret があっても CLI ログインは不要
- **シークレットキャッシュ**: MCP サーバー起動時に全環境ファイルの外部シークレット（op, aws_sm, gcp_sm, hcv）を事前解決してオンメモリにキャッシュする（`secret-cache.ts`）。execution 時にはキャッシュを優先利用し、キャッシュミス（起動後に追加された環境ファイル等）はその場で解決してキャッシュに追加。起動時の解決エラーはスキップし、execution 時にリトライされる。CLI 直接実行時はキャッシュなしで通常通り動作
- `proxy`: HTTP リクエスト・ブラウザアクセスに使用するプロキシ設定（optional）。`server` はプロキシ URL、`bypass` はバイパスドメイン（カンマ区切り）、`username`/`password` は SecretEntry 形式の認証情報（optional）。HTTP Driver は undici ProxyAgent、Browser Driver は Playwright の newContext proxy オプションで適用
  - `ca_cert_path`（optional）: 接続先サーバー用の CA 証明書ファイルパス。自己署名証明書を使う接続先や SSL インターセプト proxy 環境で使用。HTTP Driver では `requestTls.ca` に適用
  - `proxy_ca_cert_path`（optional）: proxy サーバー用の CA 証明書ファイルパス。HTTPS proxy が自己署名証明書を使う場合に使用。HTTP Driver では `proxyTls.ca` に適用
  - `reject_unauthorized`（optional）: `false` で証明書検証をスキップ。HTTP Driver では `requestTls` と `proxyTls` の両方に適用。Browser Driver では `--ignore-certificate-errors` と `ignoreHTTPSErrors` で対応
- 変数優先順位: QA Plan variables < environment file < execute_qa_plan の environment 引数
- secrets はサーバー送信時にレイヤー単位でマスクされる（`***` に置換）
- MCP の `create_environment` ツールでファイル作成可能

### Environment Resolution（レイヤーモデル）

実行時の環境変数はレイヤーの配列としてサーバーに送信される（`EnvironmentResolution`）。各レイヤーが寄与した変数をそのまま保持し、出処を追跡可能にする。

```jsonc
{
  "layers": [
    { "type": "plan", "variables": { "timeout": "30" } },
    { "type": "environment", "name": "staging", "variables": { "api_base_url": "..." } },
    { "type": "override", "variables": { "debug": "true" } }
  ]
}
```

- `type`: `"plan"`（Plan の variables）| `"environment"`（環境ファイル）| `"override"`（execute_qa_plan 引数）
- `name`: `type === "environment"` の場合のみ。環境ファイル名
- 寄与する変数がないレイヤーは配列に含めない
- executor 内部では全レイヤーをマージした resolved variables でテンプレート展開を行う

## マスキング

サーバーに送信する前にシークレット情報をマスクするルールベースシステム（`masking/`）。

- **SecretKeysRule** - Execution.environment 内の secret キーをマスク
- **HttpAuthHeaderRule** - HTTP request の Authorization ヘッダーをマスク
- **HttpSetCookieRule** - HTTP response の Set-Cookie ヘッダーをマスク
- **DomPasswordRule** - DOM snapshot 内の password input の value をマスク
- **SecretValueScanRule** - 全 artifact（HTTP, DOM）内で secret 値をスキャンするセーフティネット

`MaskRule` インターフェースを実装して `Masker` に登録すればルール追加が可能。
