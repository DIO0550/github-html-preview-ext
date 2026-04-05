# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

GitHub PR ページで HTML ファイルをプレビューするための Chrome 拡張機能（Manifest V3）。「Files changed」タブの HTML ファイルヘッダに「Preview」ボタンを追加し、ログイン済みセッションクッキーで raw HTML を取得して新規タブでレンダリングする。詳細な実装計画は `docs/plan.md` を参照。

## コマンド

- **依存関係インストール**: `pnpm install`
- **ビルド**: `pnpm build`（`tsc` → 2つの Vite ビルドを順次実行）
- **開発サーバー**: `pnpm dev`
- **テスト実行**: `pnpm test`
- **単一テスト実行**: `pnpm test -- src/path/to/file.test.ts`
- **カバレッジ付きテスト**: `pnpm test -- --coverage`

## アーキテクチャ

### ビルドシステム

2つの Vite 設定ファイルが異なる出力形式で `dist/` に生成する:

- **`vite.config.ts`** — `src/background.ts`（サービスワーカー）と `src/options/index.html`（React オプションページ）を ES モジュールとしてビルド
- **`vite.content.config.ts`** — `src/content.ts` を IIFE 形式でビルド（Web ページに注入されるコンテンツスクリプトに必須）。`emptyOutDir: false` で最初のビルド出力を保持

`pnpm build` は両方を順次実行: メインビルド（`dist/` をクリア）→ コンテンツスクリプトビルド（`dist/` に追加）。

### 拡張機能の構成

- **`src/background.ts`** — バックグラウンドサービスワーカー（イベントリスナー、拡張機能ライフサイクル）
- **`src/content.ts`** — GitHub PR ページに注入されるコンテンツスクリプト。DOM 操作（Preview ボタン追加、遅延読み込み diff 用の MutationObserver、raw HTML の取得）を担当
- **`src/options/`** — React 19 + Tailwind CSS によるオプションページ
- **`public/manifest.json`** — Chrome 拡張マニフェスト。ビルド済みアセット（`dist/assets/`）を参照

### テスト

- Vitest + `happy-dom` 環境
- Chrome API モックは `src/test/setup.ts` で設定（storage, runtime, contextMenus）
- テストファイルは `src/` 内にソースと並置、`*.test.ts` または `*.spec.ts` パターン

### スタイリング

Tailwind CSS でカスタムデザイントークンを `src/index.css` に CSS カスタムプロパティとして定義。`.dark` クラスによるライト/ダークモード対応。

## 主要な制約

- コンテンツスクリプトは IIFE 必須（コンテンツスクリプトコンテキストでは ES モジュール非対応）
- 認証はブラウザセッションクッキー（`credentials: 'include'`）を使用、PAT は不使用
- 対象ページは GitHub PR の「Files changed」（`github.com/*/pull/*/files`）
