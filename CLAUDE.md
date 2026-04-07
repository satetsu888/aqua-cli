# aqua-cli

aqua の CLI / MCP Server モノレポ。npm workspaces で複数パッケージを管理する。

## パッケージ一覧

| パッケージ | npm | 説明 |
|---|---|---|
| `packages/cli` | `@aquaqa/cli` | CLI ツール + MCP Server。テスト実行エンジン内蔵 |
| `packages/stripe-plugin` | `@aquaqa/stripe-plugin` | Stripe プラグイン。Stripe リソースの状態確認 |

## リポジトリ構成

```text
aqua-cli/
├── .changeset/                        # Changesets 設定
├── .github/workflows/
│   ├── ci.yml                         # lint/build/test（全パッケージ）
│   └── release.yml                    # Changesets + trusted publishing
├── packages/
│   ├── cli/                           # @aquaqa/cli（詳細は packages/cli/CLAUDE.md）
│   └── stripe-plugin/                 # @aquaqa/stripe-plugin
├── package.json                       # ルート（private: true, workspaces）
├── tsconfig.base.json                 # 共有 TypeScript 設定
└── package-lock.json
```

## CLI コマンド一覧

| コマンド | 説明 |
|---------|------|
| `aqua-cli login` | aqua サーバーに認証 |
| `aqua-cli logout` | 認証情報を削除 |
| `aqua-cli init` | プロジェクト設定を初期化 |
| `aqua-cli whoami` | 現在の認証ユーザーを表示 |
| `aqua-cli execute <qa_plan_id>` | QA プランを実行 |
| `aqua-cli record [url]` | ブラウザ操作を記録 |
| `aqua-cli resolve-secrets` | 環境ファイルの外部シークレットを解決して JSON 出力 |
| `aqua-cli mcp-server` | MCP サーバーを起動 |
| `aqua-cli plugin add/remove/list` | プラグイン管理 |
| `aqua-cli web` | Web UI をブラウザで開く |

## 開発コマンド

```bash
npm run build          # 全パッケージをビルド
npm test               # 全パッケージのテスト実行
npm run lint           # 全パッケージの型チェック
npx changeset          # リリース用の変更内容ファイルを作成
```

## リリース（Changesets + trusted publishing）

1. 機能開発 PR で `npx changeset` を実行し、変更内容ファイルを `.changeset/` に追加してコミット
2. PR をマージすると `changesets/action` が "Version Packages" PR を自動作成（バージョンバンプ + CHANGELOG 更新）
3. "Version Packages" PR をマージすると npm publish が自動実行（trusted publishing / OIDC で認証、provenance 付き）

## テスト方針

- Vitest 使用。全テストはユニットテスト、外部依存はすべてモック化
- ソースと同ディレクトリに `*.test.ts` で配置（co-located）
- `beforeEach` で `.mockReset()` してテスト間分離
- モジュールモック: `vi.mock()`、グローバルモック: `vi.stubGlobal()`、型付き: `vi.mocked()`
- テストデータはファクトリ関数 + `overrides` パターン
- MCP ツールテストは `createMockServer()` でツール登録をキャプチャ

## aqua-desktop 連携（デスクトップモード）

aqua-desktop から Claude Code 経由で呼ばれた場合、CLI は aqua バックエンドではなく aqua-desktop の IPC サーバーに接続する。

### 仕組み

- aqua-desktop が統合 UDS ソケット（`~/.aqua/aqua-desktop.sock`）を起動
- Claude Code サブプロセスに `AQUA_DESKTOP_SOCKET` 環境変数でソケットパスを渡す
- `AquaClient` はこの環境変数を検出すると、HTTP ではなく UDS 経由で全 API リクエストを送信
- 認証不要（ローカル接続）。リポジトリ識別は `X-Repo-Owner` / `X-Repo-Name` ヘッダーで行う
- MCP サーバー起動時にデスクトップモードを検出し、認証・プロジェクト解決をスキップ

### 対象コード

- `src/api/client.ts` — `AquaClient` の `socketPath` オプション、`requestViaSocket`、`uploadArtifactViaSocket`
- `src/mcp/server.ts` — `startMCPServer` のデスクトップモード分岐、`detectRepoInfo`
- `src/index.ts` — `mcp-server` コマンドのデスクトップモード対応

### シークレットキャッシュ

`getCachedSecret()` は環境変数 `AQUA_DESKTOP_SOCKET` が設定されている場合、ローカル Map ミス時に統合 IPC サーバー（aqua-desktop）の `GET /secrets/{key}` に HTTP over UDS で問い合わせる。接続失敗時は従来通り外部 resolver で解決する（graceful degradation）。

`resolve-secrets` コマンドは aqua-desktop から呼ばれ、環境ファイルのシークレットを一括解決して構造化 JSON を返す。失敗時には `secret_ref`（参照先）や `error_type`（`auth_required` / `resolution_failed`）を含み、aqua-desktop の UI が適切なガイダンスを表示できるようにする。

## 新しいパッケージの追加

1. `packages/<name>/` を作成（`package.json`, `tsconfig.json`, `tsup.config.ts`, `src/`）
2. `tsconfig.json` で `../../tsconfig.base.json` を extends
3. ルートの `build` スクリプトにビルド順序を追加（依存がある場合は `&&` で順序付け）
4. npmjs.com で trusted publisher を登録（Repository: `satetsu888/aqua-cli`, Workflow: `release.yml`）
