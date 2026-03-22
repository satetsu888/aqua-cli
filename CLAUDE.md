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

## 新しいパッケージの追加

1. `packages/<name>/` を作成（`package.json`, `tsconfig.json`, `tsup.config.ts`, `src/`）
2. `tsconfig.json` で `../../tsconfig.base.json` を extends
3. ルートの `build` スクリプトにビルド順序を追加（依存がある場合は `&&` で順序付け）
4. npmjs.com で trusted publisher を登録（Repository: `satetsu888/aqua-cli`, Workflow: `release.yml`）
