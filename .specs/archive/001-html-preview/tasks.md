# Tasks: GitHub PR HTML Preview

TDD ベース（Red-Green-Refactor サイクル）で Phase 順に実装を進める。
各タスクではテストを先に書き、テストが失敗する（RED）ことを確認してから実装（GREEN）し、必要に応じてリファクタリングする。

---

## Phase 0: インフラ準備

- [x] **T-00: テストインフラ拡張**
  - **説明**: `src/test/setup.ts` に fetch, window.open, chrome.runtime.sendMessage/getURL/onMessage, crypto.randomUUID のモックを追加する。既存の Chrome API モック（storage, runtime.onInstalled, contextMenus）はそのまま維持する。
  - **テストファースト**: モック追加後に `pnpm test` を実行し、既存テスト（もしあれば）が壊れないことを確認。
  - **完了条件**: `pnpm test` がパスする。fetch, window.open, chrome.runtime.sendMessage/getURL, crypto.randomUUID がテストで利用可能になっている。

- [x] **T-01: manifest.json 更新**
  - **説明**: `public/manifest.json` を以下の通り更新する。
    - `name` -> "GitHub PR HTML Preview"
    - `description` -> "Preview HTML files directly from GitHub PR's Files changed tab"
    - `matches` -> `["https://github.com/*/pull/*", "https://github.com/*/blob/*/*.html"]`
    - `permissions` に `"activeTab"` を追加
  - **テストファースト**: N/A（設定ファイル変更のため）
  - **完了条件**: `pnpm build` が成功する。manifest.json の内容が正しい。

- [x] **T-02: 共通型定義の作成**
  - **説明**: `src/content/types.ts` を作成し、各モジュール間で共有する型を定義する。
    - `FileHeaderInfo`: ファイルパス、raw URL、ヘッダ要素への参照
    - `ButtonState`: `'idle' | 'loading' | 'error'`
    - `PreviewMode`: `'new-tab' | 'inline'`
  - **テストファースト**: N/A（型定義のため）
  - **完了条件**: 型定義ファイルが作成され、`pnpm build` が成功する。

---

## Phase 1: MVP

### url-utils（URL 変換 -- 純粋関数）

- [x] **T-10: RED - url-utils のテストを書く**
  - **説明**: `src/content/url-utils.test.ts` を作成し、URL 変換ロジックのテストケースを書く。
  - **テストケース**:
    - `/blob/` -> `/raw/` 変換（通常のパス）
    - 日本語を含むファイルパス
    - スペースを含むファイルパス
    - 特殊文字（`#`, `?`, `&`）を含むパス
    - `/blob/` を含まない不正な URL -> null またはエラー
    - 完全な URL（`https://github.com/...`）と相対パスの両方
    - `injectBaseTag`: `<head>` 直後に `<base>` タグが挿入される
    - `injectBaseTag`: `<head>` がない HTML でも先頭に `<base>` が追加される
    - `getPageType`: URL パスからページ種別を判定（`'pr-files'` / `'blob-html'` / `'unknown'`）
  - **完了条件**: テストが RED（失敗）になる。実装ファイルは未作成。

- [x] **T-11: GREEN - url-utils を実装する**
  - **説明**: `src/content/url-utils.ts` を作成。`convertBlobToRawUrl`（`/blob/` → `/raw/` 置換）、`isHtmlFile`（拡張子判定）、`injectBaseTag`（DOMParser で `<base href>` 注入。相対パス解決）、`getPageType`（URL パスからページ種別判定: `'pr-files'` / `'blob-html'` / `'unknown'`）を実装する。
  - **テストファースト**: T-10 で書いたテストを通すことだけに集中する。
  - **完了条件**: T-10 のテストが全て GREEN になる。

- [x] **T-12: REFACTOR - url-utils をリファクタリング**
  - **説明**: テストが通っている状態を維持しつつ、コードを整理する。エッジケースの追加や関数シグネチャの改善があれば行う。
  - **完了条件**: テストが全て GREEN。コードが読みやすく整理されている。

### github-dom（DOM セレクタ・ファイルヘッダ検出）

- [x] **T-13: RED - github-dom のテストを書く**
  - **説明**: `src/content/github-dom.test.ts` を作成。happy-dom 上で GitHub PR Files changed タブの DOM 構造をモック構築し、検出ロジックをテストする。
  - **テストケース**:
    - `[data-tagsearch-path]` 属性を持つ要素の検出
    - `.file-header` クラスの要素の検出（フォールバック）
    - `.html` ファイルのフィルタリング（.js, .css 等は除外）
    - ファイルパスの取得（`data-tagsearch-path`, `data-path`, `title` 属性）
    - "View file" リンク（`a[href*="/blob/"]`）の href 取得（唯一の URL ソース）
    - "View file" リンクがないヘッダ（削除ファイル等）はスキップされる
    - 処理済み（ボタン挿入済み）ヘッダの除外
    - blob ページでの "Raw" ボタン検出と raw URL 取得
    - `addPreviewButtons(pageType)` がページ種別に応じた処理を呼び分ける
  - **完了条件**: テストが RED になる。

- [x] **T-14: GREEN - github-dom を実装する**
  - **説明**: `src/content/github-dom.ts` を作成。以下の関数を実装:
    - `findHtmlFileHeaders()`: 全ファイルヘッダから .html のみを返す
    - `getFilePath(header)`: ヘッダ要素からファイルパスを取得
    - `getRawUrl(header)`: "View file" リンクの href を唯一のソースとして raw URL を取得。リンクがなければ null を返す
    - `isAlreadyProcessed(header)`: ボタン挿入済みか判定
    - `getBlobPageRawUrl()`: blob ページの "Raw" ボタンから raw URL を取得
    - `addPreviewButtons(pageType)`: ページ種別に応じて PR files / blob ページの処理を呼び分け
  - **完了条件**: T-13 のテストが全て GREEN。

- [x] **T-15: REFACTOR - github-dom をリファクタリング**
  - **説明**: セレクタ定数の整理、関数の責務分離を改善。
  - **完了条件**: テストが全て GREEN。

### preview-button（ボタン生成・挿入）

- [x] **T-16: RED - preview-button のテストを書く**
  - **説明**: `src/content/preview-button.test.ts` を作成。
  - **テストケース**:
    - ボタン要素の生成（クラス名、テキスト、属性の検証）
    - ファイルヘッダへのボタン挿入（`.file-actions` への挿入）
    - 挿入位置のフォールバック（`.file-info` やヘッダ末尾）
    - 重複防止（既にボタンがある場合は挿入しない）
    - クリックハンドラの呼び出し検証
  - **完了条件**: テストが RED になる。

- [x] **T-17: GREEN - preview-button を実装する**
  - **説明**: `src/content/preview-button.ts` を作成。以下の関数を実装:
    - `createPreviewButton(onPreview)`: ボタン要素を生成
    - `insertPreviewButton(header, button)`: ヘッダにボタンを挿入
    - `addPreviewButtonToHeader(header, rawUrl)`: ヘッダに対してボタン生成から挿入まで一括実行
  - **完了条件**: T-16 のテストが全て GREEN。

- [x] **T-18: REFACTOR - preview-button をリファクタリング**
  - **説明**: ボタンスタイル定数の整理、挿入ロジックの簡潔化。
  - **完了条件**: テストが全て GREEN。

### html-fetcher（HTML 取得 + preview page 連携）

- [x] **T-19: RED - html-fetcher のテストを書く**
  - **説明**: `src/content/html-fetcher.test.ts` を作成。fetch, window.open, chrome.runtime.sendMessage/getURL をモックして検証。
  - **テストケース**:
    - 正常系: クリック時に `chrome.runtime.getURL('preview.html')` で extension page を `window.open`
    - fetch に `credentials: 'include'` が渡されていることの検証
    - fetch 成功後に `buildPreviewHtml` で `<base>` タグが注入された HTML を生成
    - `chrome.runtime.sendMessage` で `{type: 'preview-html', id, html}` が送信される
    - window.open が呼ばれること（preview URL + `'_blank'`）
  - **完了条件**: テストが RED になる。

- [x] **T-20: GREEN - html-fetcher を実装する**
  - **説明**: `src/content/html-fetcher.ts` を作成。`fetchHtmlAndOpen(rawUrl)` を実装。クリック時に `window.open(chrome.runtime.getURL('preview.html?id=xxx'), '_blank')` で同期的に preview page を開く。fetch 完了後に `buildPreviewHtml` で `<base>` 注入し、`chrome.runtime.sendMessage` で background 経由で preview page に HTML を送信。
  - **完了条件**: T-19 のテストが全て GREEN。

- [x] **T-21: REFACTOR - html-fetcher をリファクタリング**
  - **説明**: 関数の責務分離（fetch と open を分離）を検討。
  - **完了条件**: テストが全て GREEN。

### observer（MutationObserver）

- [x] **T-22: RED - observer のテストを書く**
  - **説明**: `src/content/observer.test.ts` を作成。
  - **テストケース**:
    - DOM 変更時にコールバックが呼び出される
    - 観測開始で `document.body` の `childList` + `subtree` を監視
    - 観測停止（`disconnect`）が可能
    - 初回スキャン（observer 開始時に即座にコールバック実行）
    - PJAX/Turbo 遷移時（`turbo:load`, `popstate`）にコールバック実行
    - `getPageType()` が `'unknown'` のときはコールバックをスキップ
  - **完了条件**: テストが RED になる。

- [x] **T-23: GREEN - observer を実装する**
  - **説明**: `src/content/observer.ts` を作成。以下の関数を実装:
    - `startObserving(callback)`: MutationObserver を開始し、初回スキャンも実行
    - `stopObserving()`: MutationObserver を停止
  - **完了条件**: T-22 のテストが全て GREEN。

- [x] **T-24: REFACTOR - observer をリファクタリング**
  - **説明**: observer のライフサイクル管理を改善。
  - **完了条件**: テストが全て GREEN。

### inline-preview（インライン iframe プレビュー）

- [x] **T-25: RED - inline-preview のテストを書く**
  - **説明**: `src/content/inline-preview.test.ts` を作成。
  - **テストケース**:
    - `createInlinePreview(container, html)` で iframe + wrapper が生成される
    - iframe の `srcdoc` に HTML が設定される
    - iframe の `sandbox` が `allow-scripts` に設定される
    - トグル動作: 呼び出しで展開、再呼び出しで折り畳み（`display: none`）
    - `removeInlinePreview(container)` で wrapper が削除される
  - **完了条件**: テストが RED になる。

- [x] **T-26: GREEN - inline-preview を実装する**
  - **説明**: `src/content/inline-preview.ts` を作成。
    - `createInlinePreview(container, html)`: diff/ファイル下部に sandboxed iframe を挿入
    - `toggleInlinePreview(container, html)`: 展開/折り畳みのトグル
    - `removeInlinePreview(container)`: iframe 削除 + srcdoc クリア
  - **完了条件**: T-25 のテストが全て GREEN。

- [x] **T-27: REFACTOR - inline-preview をリファクタリング**
  - **完了条件**: テストが全て GREEN。

### side-panel（サイドパネルプレビュー）

- [x] **T-28: RED - side-panel のテストを書く**
  - **説明**: `src/content/side-panel.test.ts` を作成。
  - **テストケース**:
    - `createSidePanel()` で fixed パネルが `document.body` に追加される
    - `showInPanel(html, fileName)` で iframe.srcdoc に HTML が設定される
    - パネルにファイル名が表示される
    - 閉じるボタンでパネルが削除される
    - `document.body.style.marginRight` でページレイアウトが調整される
    - パネル閉じ時に `marginRight` が元に戻る
  - **完了条件**: テストが RED になる。

- [x] **T-29: GREEN - side-panel を実装する**
  - **説明**: `src/content/side-panel.ts` を作成。
    - `createSidePanel()`: fixed パネル + リサイズハンドル + ヘッダ + iframe を生成
    - `showInPanel(html, fileName)`: パネルに HTML を表示（パネルがなければ作成）
    - `closeSidePanel()`: パネル削除 + レイアウト復元
    - リサイズ: mousedown/mousemove/mouseup でパネル幅をドラッグ変更
  - **完了条件**: T-28 のテストが全て GREEN。

- [x] **T-30: REFACTOR - side-panel をリファクタリング**
  - **完了条件**: テストが全て GREEN。

### preview-button 更新（3ボタン対応）

- [x] **T-31: preview-button を3ボタン構成に更新**
  - **説明**: `preview-button.ts` と `preview-button.test.ts` を更新。各ファイルヘッダに3つのボタンを挿入:
    - 「Preview」（新規タブ）: fetchAndPreview 呼び出し
    - 「Inline」: fetchPreviewHtml → toggleInlinePreview 呼び出し
    - 「Panel」: fetchPreviewHtml → showInPanel 呼び出し
  - **テストファースト**: 3ボタンの生成・挿入・クリックハンドラのテストを先に追加。
  - **完了条件**: テストが全て GREEN。3つのボタンが各ヘッダに挿入される。

### 統合

- [x] **T-32: content.ts 統合 + ビルド確認**
  - **説明**: `src/content.ts` を書き換え、全モジュールを統合する。
    - `url-utils`, `github-dom`, `preview-button`, `html-fetcher`, `observer`, `inline-preview`, `side-panel` をインポート
    - `addPreviewButtons(pageType)` 関数を定義（github-dom でヘッダ検出 -> preview-button で3ボタン挿入）
    - `startObserving(addPreviewButtons)` で監視開始
  - **テストファースト**: 統合テストを書いてからエントリポイントを実装する（オプション）。
  - **完了条件**: `pnpm build` が成功する。`pnpm test` が全てパスする。`dist/assets/content.js` が IIFE として生成される。

---

## Phase 2: 堅牢化

### エラーハンドリング

- [x] **T-33: RED - エラーハンドリングのテストを追加**
  - **説明**: `html-fetcher.test.ts` と `preview-button.test.ts` にエラーケースのテストを追加する。
  - **テストケース**:
    - fetch ネットワークエラー時にボタンが "Network error" 状態になる
    - fetch 401/403 時にボタンが "Session expired" 状態になる
    - fetch その他エラー時にボタンが "Preview failed" 状態になる
    - エラー表示が 3 秒後に元に戻る
    - ボタン loading 状態の表示（"Loading..." + disabled）
  - **完了条件**: テストが RED になる。

- [x] **T-34: GREEN - エラーハンドリングを実装する**
  - **説明**: `preview-button.ts` に `updateButtonState(btn, state, message?)` を追加。`html-fetcher.ts` にエラー種別判定とボタン状態更新を追加。セッション切れはレスポンス URL のチェックで検知。
  - **完了条件**: T-33 のテストが全て GREEN。

### Preview Page + Background Messaging

- [x] **T-35: RED - preview page のテストを書く**
  - **説明**: `src/preview.test.ts` を作成。preview.html + preview.ts のメッセージ受信 → iframe srcdoc 書き込みをテスト。
  - **テストケース**:
    - `chrome.runtime.onMessage` で `{type: 'preview-html', id, html}` を受信
    - 受信した HTML が iframe の srcdoc に設定される
    - ID が一致しないメッセージは無視される
  - **完了条件**: テストが RED になる。

- [x] **T-36: GREEN - preview page + background messaging を実装する**
  - **説明**:
    - `src/preview.html` を作成（sandboxed iframe を含む extension page）
    - `src/preview.ts` を作成（`chrome.runtime.onMessage` で HTML 受信 → iframe.srcdoc に書き込み）
    - `src/background.ts` にメッセージ転送ロジックを追加（content script → preview page タブ）
    - `vite.config.ts` に preview.html のビルドエントリを追加
    - `public/manifest.json` に `web_accessible_resources` を追加
  - **完了条件**: T-35 のテストが全て GREEN。ビルドが通る。

### テーマ対応

- [x] **T-37: ダーク/ライトテーマ対応**
  - **説明**: ボタンが GitHub の既存 CSS 変数（`--color-btn-bg` 等）を使用してテーマに自動追従することを確認。必要であればカスタムスタイルを追加。
  - **テストファースト**: `github-dom.test.ts` に `data-color-mode` 属性の検出テストを追加。
  - **完了条件**: ダークモード/ライトモードでボタンが適切に表示される。テストがパスする。

### debounce

- [x] **T-38: RED - debounce のテストを書く**
  - **説明**: `observer.test.ts` に debounce のテストを追加する。
  - **テストケース**:
    - 150ms 以内の連続呼び出しで最後の 1 回のみ実行される
    - 150ms 経過後に別の呼び出しがあれば再度実行される
    - コールバックの引数が正しく渡される
  - **完了条件**: テストが RED になる。

- [x] **T-39: GREEN - debounce を実装する**
  - **説明**: `observer.ts` に `debounce(fn, delay)` ユーティリティを実装。MutationObserver のコールバックを debounce (150ms) でラップ。
  - **完了条件**: T-43 のテストが全て GREEN。

### Phase 2 統合

- [x] **T-40: Phase 2 統合 + リグレッションテスト**
  - **説明**: Phase 2 の全変更を content.ts に反映。全テストが通ることを確認。
  - **完了条件**: `pnpm build` 成功。`pnpm test` 全パス。

---

## Phase 3: 拡張

### viewport 切替

- [x] **T-41: RED - viewport-toggle のテストを書く**
  - **説明**: `src/content/viewport-toggle.test.ts` を作成。
  - **テストケース**:
    - viewport 切替 UI（ボタングループ）の生成
    - Mobile (375px) / Tablet (768px) / Desktop (100%) の切替
    - iframe の width が正しく変更される
    - アクティブなボタンの視覚的フィードバック
  - **完了条件**: テストが RED になる。

- [x] **T-42: GREEN - viewport-toggle を実装する**
  - **説明**: `src/content/viewport-toggle.ts` を作成。
    - `createViewportToggle(iframe)`: 切替 UI を生成
    - `setViewport(iframe, viewport)`: iframe の width を変更
  - **完了条件**: T-41 のテストが全て GREEN。

### 一括プレビュー

- [x] **T-43: RED - batch-preview のテストを書く**
  - **説明**: `src/content/batch-preview.test.ts` を作成。
  - **テストケース**:
    - "Preview All HTML" ボタンの生成
    - HTML ファイル数のカウント表示（例: "Preview all HTML (5)"）
    - クリックで全 HTML ファイルの fetch + 新規タブ表示
    - HTML ファイルが 0 個の場合はボタン非表示
  - **完了条件**: テストが RED になる。

- [x] **T-44: GREEN - batch-preview を実装する**
  - **説明**: `src/content/batch-preview.ts` を作成。
    - `createBatchPreviewButton()`: PR ヘッダ付近にボタンを挿入
    - `previewAllHtml()`: 全 HTML ファイルを順次 fetch + 表示
  - **完了条件**: T-43 のテストが全て GREEN。

### Phase 3 統合

- [x] **T-45: Phase 3 統合 + content.ts 更新**
  - **説明**: content.ts に Phase 3 モジュール（viewport-toggle, batch-preview）を統合。インライン・サイドパネルの iframe に viewport 切替 UI を追加。
  - **完了条件**: `pnpm build` 成功。`pnpm test` 全パス。全 Phase の Definition of Done を満たす。
