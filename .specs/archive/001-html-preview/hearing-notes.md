# Hearing Notes: GitHub PR HTML Preview

## 目的

GitHub の Private repo の PR 画面 (Files changed タブ) で、変更された HTML ファイルの隣に「Preview」ボタンを表示し、クリックすると新規タブでレンダリング結果を確認できるようにする。Claude Code on the web が作った PR を、ダウンロードせずにブラウザ上でレビュー・マージできる状態を作る。

## スコープ

- **種別**: 新規機能
- **影響範囲**: 新規（既存テンプレートの content.ts, background.ts, manifest.json を拡張）
- **優先度**: 高
- **Phase 1 (MVP)**: Preview ボタン表示 + クリックで新規タブプレビュー + MutationObserver による遅延読み込み対応 + `/blob/` ページ（通常のファイル閲覧）対応
- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、ダーク/ライトテーマ対応、折り畳み対応、MutationObserver debounce
- **Phase 3 (拡張)**: インライン iframe プレビュー、viewport 切替、一括プレビュー

## 技術的詳細

- **技術スタック**: TypeScript
- **フレームワーク**: Chrome Extension Manifest V3 / React 19 + Tailwind CSS（オプションページ）
- **ビルドシステム**: Vite（2つの設定: メインビルド + IIFE コンテンツスクリプト）
- **依存関係**: Chrome Extension API (chrome.storage, chrome.runtime)
- **認証方式**: ブラウザセッションクッキー (`credentials: 'include'`)、PAT 不使用
- **データフロー**:
  1. コンテンツスクリプトが GitHub PR ページの DOM を監視
  2. `.html` ファイルのヘッダに Preview ボタンを挿入
  3. クリック時に raw URL を fetch → Blob 化 → 新規タブで表示
- **raw URL 形式**: `github.com/{owner}/{repo}/raw/refs/heads/{branch}/{path}` → セッションクッキー経由で認証 → `raw.githubusercontent.com` にリダイレクト
- **DOM セレクタ**: 未確定（GitHub PR Files changed タブの実際の DOM 構造を調査して確定する必要あり）。plan.md では `.file-header`, `[data-testid="..."]`, `data-path` 属性等を候補として挙げている

## 品質要件

- **エッジケース**:
  - GitHub の DOM 構造変更（複数セレクタでフォールバック）
  - 日本語・スペース・特殊文字を含むファイルパス
  - 大きなHTML ファイル（数百KB）
  - セッション切れ（リダイレクト先がログイン画面）
  - diff の折り畳み状態
  - ダーク/ライトテーマ
- **エラーハンドリング**: fetch 失敗時にボタン上にエラー表示、ネットワーク切れ検知
- **テスト要件**: TDD (Red-Green-Refactor) で進める。Vitest + happy-dom 環境。URL 変換、HTML 検出、ボタン挿入ロジック等の核心部分をテストファースト
- **パフォーマンス**: MutationObserver の debounce (100ms 程度)、Blob URL のメモリ解放

## 追加コンテキスト

- plan.md では Violentmonkey ユーザースクリプト形式で記述されているが、実装は Chrome 拡張 (Manifest V3) として行う
- コンテンツスクリプトは IIFE 必須（ES モジュール非対応）
- manifest.json の matches を `github.com/*/pull/*/files` に変更する必要あり
- 骨格コードが plan.md に記載されており、Chrome 拡張用に適応して使用する
