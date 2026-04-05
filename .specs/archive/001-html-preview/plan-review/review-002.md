OpenAI Codex v0.117.0 (research preview)
--------
workdir: /workspace
model: gpt-5.4
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 019d5d21-a8ff-7a91-baf7-367db06cd9e6
--------
user
以下の実装計画をレビューしてください。

【重要】ファイルの作成・編集は一切行わないでください。レビュー結果は標準出力のみで回答してください。

レビュー対象: .specs/001-html-preview/implementation-plan.md

前回のレビュー (plan-review/review-001.md) で以下の指摘があり、修正済みです:
1. セキュリティ方針の明文化（動的実行許可 + noopener + sandbox 制限）
2. 相対パス解決（<base> タグ注入）
3. ポップアップブロック回避（空タブを同期的に開く + document.write）
4. matches 拡大（/pull/* + runtime 判定 + turbo:load/popstate 対応）
5. URL ソースの一本化（View file リンクの href のみ使用）
6. DOM セレクタの整理（div[id^="diff-"] 除外、data-testid 不整合修正）

レビュー観点:
1. 前回の指摘が適切に反映されているか
2. 新たな仕様の曖昧さ・抜け漏れはないか
3. 実装可能性に問題はないか
4. エッジケースは考慮されているか
5. 全体アーキテクチャとの整合性はあるか

問題がなければ「問題なし」と回答してください。
問題があれば具体的な指摘と改善案を提示してください。
warning: Codex could not find system bubblewrap at /usr/bin/bwrap. Please install bubblewrap with your package manager. Codex will use the vendored bubblewrap in the meantime.
codex
レビュー対象と前回指摘の反映状況を確認します。まず計画書と前回レビューを読み、差分観点で曖昧さ・実装不能要素・抜けを洗います。
exec
/bin/bash -lc "sed -n '1,260p' /workspace/.specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
# Implementation Plan: GitHub PR HTML Preview

## 1. 概要

GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。

### スコープ

- **Phase 1 (MVP)**: Preview ボタン表示 + 新規タブプレビュー + MutationObserver
- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、テーマ対応、debounce
- **Phase 3 (拡張)**: インライン iframe、viewport 切替、一括プレビュー、blob/ ページ対応

### 前提

- plan.md ではユーザースクリプト形式だが、Chrome 拡張 (Manifest V3) として実装する
- コンテンツスクリプトは IIFE 必須（Vite でバンドル。ソースでは import 可能）
- 認証はブラウザセッションクッキー（`credentials: 'include'`）、PAT 不使用

### セキュリティ方針

- **プレビューは動的実行を許可する**: 教育 HTML のクイズ JS 等を動作確認する用途のため、script 実行を制限しない
- **`window.open` には `noopener` を指定**: opener への参照を遮断する
- **Phase 3 の iframe は `sandbox="allow-scripts"`**: `allow-same-origin` は付与しない（Blob URL のため不要）
- **ユーザーが意図的にプレビューする操作フロー**のため、untrusted HTML の実行リスクはユーザー判断に委ねる

### 相対パス解決方針

- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
- **Phase 1**: `<base href>` タグを HTML の `<head>` に注入し、raw URL のディレクトリを基準 URL とする
- 注入する base URL: `https://github.com/{owner}/{repo}/raw/{sha}/{dir}/`
- これにより `./style.css` 等の相対参照が raw URL 経由で解決される

---

## 2. システム図

### 2.1 状態マシン図（コンテンツスクリプトのライフサイクル）

```
                          +-----------+
                          |   IDLE    |
                          | (初期状態) |
                          +-----+-----+
                                |
                          page load / document_end
                                |
                                v
                    +---------------------+
                    |   OBSERVING         |
                    | MutationObserver    |
                    | 起動 + 初回スキャン   |
                    +-----+--------+------+
                          |        ^
                 DOM変更検出 |        | debounce 後に再監視
                          v        |
                  +----------------+------+
                  |  SCANNING             |
                  |  ファイルヘッダ検出     |
                  |  (.html判定)           |
                  +---+------+------+-----+
                      |      |      |
            HTML なし  |      |      | エラー（DOM構造変更）
            +---------+      |      +----------+
            |                |                 |
            v                v                 v
     (OBSERVING       +------------+    +-----------+
      に戻る)         | INSERTING  |    |   ERROR   |
                      | ボタン挿入  |    | ログ出力   |
                      +-----+------+    +-----+-----+
                            |                 |
                            v                 v
                      +------------+    (OBSERVING
                      |  WAITING   |     に戻る)
                      | クリック待ち |
                      +-----+------+
                            |
                      ユーザーがクリック
                            |
                            v
                      +------------+
                      |  FETCHING  |
                      | raw HTML   |
                      | fetch 実行  |
                      +-----+------+
                            |
                +-----------+-----------+
                |                       |
          成功 (200)              失敗 / タイムアウト
                |                       |
                v                       v
         +-------------+        +--------------+
         |  PREVIEWING |        | FETCH_ERROR  |
         | Blob生成     |        | ボタンに      |
         | 新規タブ表示  |        | エラー表示    |
         +------+------+        +------+-------+
                |                       |
                v                       v
          (WAITING                (WAITING
           に戻る)                 に戻る)
```

### 2.2 データフロー図

#### Phase 1-2: 新規タブプレビュー

```
+----------+     click      +------------------+     fetch      +----------------+
|  User    +--------------->| Content Script   +--------------->| github.com     |
|          |                | (content.ts)     |  credentials:  | /raw/refs/     |
+----------+                +--------+---------+  include       | heads/{branch} |
                                     |                          | /{path}        |
                                     |                          +-------+--------+
                                     |                                  |
                                     |                          302 redirect
                                     |                                  |
                                     |                                  v
                                     |                          +----------------+
                                     |                          | raw.github     |
                                     |            response      | usercontent    |
                                     |<-------------------------+ .com           |
                                     |            (HTML text)   +----------------+
                                     |
                                     | new Blob([html], {type: 'text/html'})
                                     | URL.createObjectURL(blob)
                                     |
                                     v
                              +------+-------+
                              | window.open  |
                              | (blob:// URL)|
                              | 新規タブ      |
                              +--------------+
```

#### Phase 3: インライン iframe プレビュー

```
+----------+     click      +------------------+     fetch      +----------------+
|  User    +--------------->| Content Script   +--------------->| github.com     |
|          |                | (content.ts)     |                | /raw/...       |
+----+-----+                +--------+---------+                +-------+--------+
     |                               |                                  |
     |                               |<---------------------------------+
     |                               |  response (HTML text)
     |                               |
     |                               | new Blob([html], {type: 'text/html'})
     |                               | URL.createObjectURL(blob)
     |                               |
     |                               v
     |                      +--------+---------+
     |                      | <iframe>         |
     |    viewport toggle   | diff 直下に挿入   |
     +--------------------->| src=blob:// URL  |
     |   320px / 768px /    +--------+---------+
     |   100%                        |
     |                               |
     |   "Open all HTML"             v
     +------------------------> 一括プレビュー
         PRヘッダの                  (全 .html ファイルを
         ボタンから                   順次 fetch + iframe)
```

---

## 3. ファイル構成

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `public/manifest.json` | `name`, `description`, `matches`（`/pull/*` に拡大）, `permissions` の更新 |
| `src/content.ts` | エントリポイントとして各モジュールを統合 |
| `src/background.ts` | 必要に応じて設定管理を追加 |
| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |

### 新規ファイル

| ファイル | 責務 |
|---------|------|
| `src/content/types.ts` | 共通型定義（ButtonState, FileHeaderInfo 等） |
| `src/content/url-utils.ts` | URL 変換（blob -> raw）、`<base>` タグ注入。純粋関数 |
| `src/content/url-utils.test.ts` | URL 変換のユニットテスト |
| `src/content/github-dom.ts` | GitHub DOM セレクタ、ファイルヘッダ検出、HTML ファイル判定 |
| `src/content/github-dom.test.ts` | DOM 検出のテスト（happy-dom） |
| `src/content/preview-button.ts` | Preview ボタンの生成・挿入・重複防止・状態管理 |
| `src/content/preview-button.test.ts` | ボタン挿入のテスト |
| `src/content/html-fetcher.ts` | raw HTML の fetch + Blob 化 + window.open |
| `src/content/html-fetcher.test.ts` | fetch フローのテスト（モック） |
| `src/content/observer.ts` | MutationObserver + debounce |
| `src/content/observer.test.ts` | Observer のテスト |
| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
| `src/content/viewport-toggle.ts` | Phase 3: viewport 切替 UI |
| `src/content/viewport-toggle.test.ts` | Phase 3: viewport 切替のテスト |
| `src/content/batch-preview.ts` | Phase 3: 一括プレビュー |
| `src/content/batch-preview.test.ts` | Phase 3: 一括プレビューのテスト |

---

## 4. Phase 1 (MVP) 実装詳細

### 4.1 DOM セレクタ戦略

GitHub PR の Files changed タブのファイルヘッダ検出は、複数セレクタでフォールバックする:

```typescript
const FILE_HEADER_SELECTORS = [
  '[data-tagsearch-path]',           // data属性ベース（最安定）
  '.file-header[data-path]',         // クラス + data属性
  '.file-header',                    // クラスのみ（フォールバック）
] as const;
```

パス取得も複数戦略でフォールバック:

```typescript
const FILE_PATH_EXTRACTORS = [
  (el: Element) => el.getAttribute('data-tagsearch-path'),
  (el: Element) => el.getAttribute('data-path'),
  (el: Element) => el.querySelector('[title]')?.getAttribute('title'),
] as const;
```

検出優先順位: `data-*` 属性 > クラス名。`div[id^="diff-"]` は広すぎるため除外。

**ページタイプ判定**: `matches` を `/pull/*` に広げるため、content script 内で URL パスから Files changed タブかどうかを runtime 判定する:

```typescript
function isFilesChangedTab(): boolean {
  return /\/pull\/\d+\/files/.test(location.pathname);
}
```

GitHub の PJAX/Turbo 遷移に対応するため、`popstate` イベントや `turbo:load` イベントも監視する。

### 4.2 URL 変換

**URL ソース**: "View file" リンク (`a[href*="/blob/"]`) の absolute href を唯一のソースとする。ファイルヘッダからの独自構築は行わない（fork PR やブランチ名に `/` を含むケースで壊れるため）。

```
入力: https://github.com/owner/repo/blob/{sha}/{path}
出力: https://github.com/owner/repo/raw/{sha}/{path}

変換: "/blob/" -> "/raw/" の単純置換
```

"View file" リンクが見つからないファイル（削除ファイル、rename の旧名側）は非対応とし、ボタンを挿入しない。

特殊文字の扱い: ブラウザが href を自動エンコード済みのため、追加の `encodeURI` は不要。`#` や `?` を含むファイル名は href のパース時に壊れる可能性があるが、GitHub がそれらを適切にエンコードした href を生成するため問題なし。

### 4.3 ボタン挿入

```typescript
// ボタンの識別用カスタム属性（重複防止）
const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';

// GitHub のボタンスタイルに合わせる
const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
```

挿入位置: ファイルヘッダ内の `.file-actions` または `.file-info`、末尾にフォールバック。既存のアクションボタン群の隣に配置。

exec
/bin/bash -lc "sed -n '1,260p' /workspace/plan-review/review-001.md" in /workspace
 exited 2 in 0ms:
sed: can't read /workspace/plan-review/review-001.md: No such file or directory

exec
/bin/bash -lc "rg --files /workspace/.specs /workspace/plan-review | sed 's#"'^/workspace/##'"'" in /workspace
 succeeded in 0ms:
rg: /workspace/plan-review: No such file or directory (os error 2)
.specs/001-html-preview/exploration-report.md
.specs/001-html-preview/PLANNING
.specs/001-html-preview/hearing-notes.md
.specs/001-html-preview/tasks.md
.specs/001-html-preview/implementation-plan.md
.specs/001-html-preview/plan-review/review-002.md
.specs/001-html-preview/plan-review/review-001.md
.specs/001-html-preview/plan-review/prompt-002.txt
.specs/001-html-preview/plan-review/prompt-001.txt

codex
前回レビューの保存場所が想定と異なっていたため、仕様配下の記録を参照し直します。残りの実装計画も通して読み、修正点が各フェーズまで一貫して反映されているか確認します。
exec
/bin/bash -lc "sed -n '261,520p' /workspace/.specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:

重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。

### 4.4 fetch + Blob + 新規タブ

**ポップアップブロック回避**: `await fetch` 後の `window.open` はユーザー操作コンテキスト外となりブロックされる可能性がある。対策として、クリック直後に空タブを同期的に開き、fetch 完了後にそのタブに HTML を書き込む:

```typescript
async function fetchAndPreview(rawUrl: string): Promise<void> {
  // クリックイベント内で同期的にタブを開く（ポップアップブロック回避）
  const newTab = window.open('about:blank', '_blank', 'noopener');
  if (!newTab) throw new Error('Popup blocked');

  const response = await fetch(rawUrl, { credentials: 'include' });
  if (!response.ok) {
    newTab.close();
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();

  // <base> タグを注入して相対パスを解決
  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
  const htmlWithBase = injectBaseTag(html, baseUrl);

  newTab.document.open();
  newTab.document.write(htmlWithBase);
  newTab.document.close();
}

function injectBaseTag(html: string, baseUrl: string): string {
  // <head> タグの直後に <base> を挿入
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head><base href="${baseUrl}">`);
  }
  if (html.includes('<head ')) {
    return html.replace(/<head\s[^>]*>/, `$&<base href="${baseUrl}">`);
  }
  // <head> がない場合は先頭に追加
  return `<base href="${baseUrl}">${html}`;
}
```

### 4.5 MutationObserver

GitHub PR は diff を遅延読み込みするため、DOM 変更を監視してボタンを挿入する。また、GitHub の PJAX/Turbo 遷移にも対応:

```typescript
const observer = new MutationObserver(() => {
  if (isFilesChangedTab()) {
    addPreviewButtons();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// PJAX/Turbo 遷移対応
document.addEventListener('turbo:load', () => {
  if (isFilesChangedTab()) addPreviewButtons();
});
window.addEventListener('popstate', () => {
  if (isFilesChangedTab()) addPreviewButtons();
});

// 初回スキャン
if (isFilesChangedTab()) addPreviewButtons();
```

---

## 5. Phase 2 (堅牢化) 実装詳細

### 5.1 エラーハンドリング

fetch 失敗時のユーザーフィードバック:

```
+------------------+     +-------------------+     +------------------+
| fetch 実行       | --> | レスポンス判定     | --> | 成功: プレビュー  |
+------------------+     +---+---------------+     +------------------+
                             |
                             | 失敗
                             v
                   +---------+----------+
                   | エラー種別判定      |
                   +--+------+------+---+
                      |      |      |
                      v      v      v
                  network  401/   その他
                  error    403
                      |      |      |
                      v      v      v
                  "Network "Session "Preview
                   error"  expired" failed"
```

ボタンの状態管理:

```typescript
type ButtonState = 'idle' | 'loading' | 'error';
```

ボタンのテキストを一時的にエラーメッセージに変更し、3秒後に復帰する。

セッション切れ検知: レスポンスの URL がログインページにリダイレクトされた場合を判定。

### 5.2 Blob URL 解放

```typescript
const BLOB_URL_LIFETIME_MS = 30_000; // 30秒

// 既存 Blob URL の管理マップ
const blobUrls: Map<string, { url: string; createdAt: number }> = new Map();

function createManagedBlobUrl(blob: Blob, key: string): string {
  // 既存の Blob URL があれば解放
  const existing = blobUrls.get(key);
  if (existing) URL.revokeObjectURL(existing.url);

  const url = URL.createObjectURL(blob);
  blobUrls.set(key, { url, createdAt: Date.now() });

  setTimeout(() => {
    URL.revokeObjectURL(url);
    blobUrls.delete(key);
  }, BLOB_URL_LIFETIME_MS);

  return url;
}
```

### 5.3 テーマ対応

GitHub の `data-color-mode` 属性と既存 CSS 変数を活用:

```typescript
function getTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-color-mode') === 'dark'
    ? 'dark' : 'light';
}
```

GitHub ネイティブの `btn` クラスを使うことで基本的に自動追従する。カスタムスタイルが必要な場合のみ `--color-btn-bg`, `--color-btn-text` 等の CSS 変数を参照。

### 5.4 debounce

MutationObserver の過剰発火を抑制:

```typescript
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

// 使用: 150ms debounce
const debouncedAddButtons = debounce(addPreviewButtons, 150);
const observer = new MutationObserver(debouncedAddButtons);
```

### 5.5 折り畳み対応

diff が collapsed 状態のファイルにもボタンを挿入。ファイルヘッダは折り畳み時も表示されるため、通常のセレクタで対応可能。

---

## 6. Phase 3 (拡張) 実装詳細

### 6.1 インライン iframe プレビュー

diff ブロックの直下に iframe を挿入:

```typescript
function createInlinePreview(
  container: Element,
  blobUrl: string,
  viewportWidth: string
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = blobUrl;
  iframe.style.cssText = `
    width: ${viewportWidth};
    height: 400px;
    border: 1px solid var(--color-border-default);
    border-radius: 6px;
    resize: vertical;
    overflow: auto;
  `;
  iframe.setAttribute('sandbox', 'allow-scripts');
  container.appendChild(iframe);
  return iframe;
}
```

トグル動作: 「Inline Preview」ボタンをクリックで展開/折り畳み。

### 6.2 viewport 切替

```
+------------------------------------------+
| [Mobile 375px] [Tablet 768px] [Desktop]  |  <-- 切替 UI
+------------------------------------------+
| +--------------------------------------+ |
| |          iframe preview              | |
| |      (width 動的変更)                 | |
| +--------------------------------------+ |
+------------------------------------------+
```

プリセット:

```typescript
const VIEWPORTS = {
  mobile:  { width: '375px',  label: 'Mobile' },
  tablet:  { width: '768px',  label: 'Tablet' },
  desktop: { width: '100%',   label: 'Desktop' },
} as const;
```

### 6.3 一括プレビュー

PR ヘッダ付近に「Preview all HTML files」ボタンを追加:

```typescript
async function previewAllHtml(): Promise<void> {
  const htmlHeaders = findAllHtmlFileHeaders();
  for (const header of htmlHeaders) {
    const rawUrl = getRawUrlFromHeader(header);
    if (rawUrl) await fetchHtmlAndOpen(rawUrl);
  }
}
```

### 6.4 blob/ ページ対応

manifest.json の matches を拡張:

```json
{
  "matches": [
    "https://github.com/*/pull/*",
    "https://github.com/*/blob/*/*.html"
  ]
}
```

`/blob/` ページでは既存の "Raw" ボタンの隣に "Preview" を追加。ページタイプに応じたセレクタを使い分け。

---

## 7. テスト戦略

### 7.1 テスト環境

exec
/bin/bash -lc "sed -n '1,260p' /workspace/.specs/001-html-preview/plan-review/review-001.md" in /workspace
 succeeded in 0ms:
OpenAI Codex v0.117.0 (research preview)
--------
workdir: /workspace
model: gpt-5.4
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 019d5cfc-572f-7002-9b19-49a7137aa1b9
--------
user
以下の実装計画をレビューしてください。

【重要】ファイルの作成・編集は一切行わないでください。レビュー結果は標準出力のみで回答してください。

レビュー対象: .specs/001-html-preview/implementation-plan.md

レビュー観点:
1. 仕様の曖昧さ・抜け漏れはないか
2. 実装可能性に問題はないか
3. エッジケースは考慮されているか
4. ファイル構成は妥当か
5. 全体アーキテクチャとの整合性はあるか

問題がなければ「問題なし」と回答してください。
問題があれば具体的な指摘と改善案を提示してください。
warning: Codex could not find system bubblewrap at /usr/bin/bwrap. Please install bubblewrap with your package manager. Codex will use the vendored bubblewrap in the meantime.
codex
対象の実装計画と周辺構成を読み、計画の前提になっている既存アーキテクチャとの整合性まで確認します。まず対象ファイルと関連ディレクトリ構成を把握します。
exec
/bin/bash -lc "sed -n '1,240p' /workspace/.specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
# Implementation Plan: GitHub PR HTML Preview

## 1. 概要

GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。

### スコープ

- **Phase 1 (MVP)**: Preview ボタン表示 + 新規タブプレビュー + MutationObserver
- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、テーマ対応、debounce
- **Phase 3 (拡張)**: インライン iframe、viewport 切替、一括プレビュー、blob/ ページ対応

### 前提

- plan.md ではユーザースクリプト形式だが、Chrome 拡張 (Manifest V3) として実装する
- コンテンツスクリプトは IIFE 必須（Vite でバンドル。ソースでは import 可能）
- 認証はブラウザセッションクッキー（`credentials: 'include'`）、PAT 不使用

---

## 2. システム図

### 2.1 状態マシン図（コンテンツスクリプトのライフサイクル）

```
                          +-----------+
                          |   IDLE    |
                          | (初期状態) |
                          +-----+-----+
                                |
                          page load / document_end
                                |
                                v
                    +---------------------+
                    |   OBSERVING         |
                    | MutationObserver    |
                    | 起動 + 初回スキャン   |
                    +-----+--------+------+
                          |        ^
                 DOM変更検出 |        | debounce 後に再監視
                          v        |
                  +----------------+------+
                  |  SCANNING             |
                  |  ファイルヘッダ検出     |
                  |  (.html判定)           |
                  +---+------+------+-----+
                      |      |      |
            HTML なし  |      |      | エラー（DOM構造変更）
            +---------+      |      +----------+
            |                |                 |
            v                v                 v
     (OBSERVING       +------------+    +-----------+
      に戻る)         | INSERTING  |    |   ERROR   |
                      | ボタン挿入  |    | ログ出力   |
                      +-----+------+    +-----+-----+
                            |                 |
                            v                 v
                      +------------+    (OBSERVING
                      |  WAITING   |     に戻る)
                      | クリック待ち |
                      +-----+------+
                            |
                      ユーザーがクリック
                            |
                            v
                      +------------+
                      |  FETCHING  |
                      | raw HTML   |
                      | fetch 実行  |
                      +-----+------+
                            |
                +-----------+-----------+
                |                       |
          成功 (200)              失敗 / タイムアウト
                |                       |
                v                       v
         +-------------+        +--------------+
         |  PREVIEWING |        | FETCH_ERROR  |
         | Blob生成     |        | ボタンに      |
         | 新規タブ表示  |        | エラー表示    |
         +------+------+        +------+-------+
                |                       |
                v                       v
          (WAITING                (WAITING
           に戻る)                 に戻る)
```

### 2.2 データフロー図

#### Phase 1-2: 新規タブプレビュー

```
+----------+     click      +------------------+     fetch      +----------------+
|  User    +--------------->| Content Script   +--------------->| github.com     |
|          |                | (content.ts)     |  credentials:  | /raw/refs/     |
+----------+                +--------+---------+  include       | heads/{branch} |
                                     |                          | /{path}        |
                                     |                          +-------+--------+
                                     |                                  |
                                     |                          302 redirect
                                     |                                  |
                                     |                                  v
                                     |                          +----------------+
                                     |                          | raw.github     |
                                     |            response      | usercontent    |
                                     |<-------------------------+ .com           |
                                     |            (HTML text)   +----------------+
                                     |
                                     | new Blob([html], {type: 'text/html'})
                                     | URL.createObjectURL(blob)
                                     |
                                     v
                              +------+-------+
                              | window.open  |
                              | (blob:// URL)|
                              | 新規タブ      |
                              +--------------+
```

#### Phase 3: インライン iframe プレビュー

```
+----------+     click      +------------------+     fetch      +----------------+
|  User    +--------------->| Content Script   +--------------->| github.com     |
|          |                | (content.ts)     |                | /raw/...       |
+----+-----+                +--------+---------+                +-------+--------+
     |                               |                                  |
     |                               |<---------------------------------+
     |                               |  response (HTML text)
     |                               |
     |                               | new Blob([html], {type: 'text/html'})
     |                               | URL.createObjectURL(blob)
     |                               |
     |                               v
     |                      +--------+---------+
     |                      | <iframe>         |
     |    viewport toggle   | diff 直下に挿入   |
     +--------------------->| src=blob:// URL  |
     |   320px / 768px /    +--------+---------+
     |   100%                        |
     |                               |
     |   "Open all HTML"             v
     +------------------------> 一括プレビュー
         PRヘッダの                  (全 .html ファイルを
         ボタンから                   順次 fetch + iframe)
```

---

## 3. ファイル構成

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `public/manifest.json` | `name`, `description`, `matches`, `permissions` の更新 |
| `src/content.ts` | エントリポイントとして各モジュールを統合 |
| `src/background.ts` | 必要に応じて設定管理を追加 |
| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |

### 新規ファイル

| ファイル | 責務 |
|---------|------|
| `src/content/types.ts` | 共通型定義（ButtonState, FileHeaderInfo 等） |
| `src/content/url-utils.ts` | URL 変換（blob -> raw, パス抽出）。純粋関数 |
| `src/content/url-utils.test.ts` | URL 変換のユニットテスト |
| `src/content/github-dom.ts` | GitHub DOM セレクタ、ファイルヘッダ検出、HTML ファイル判定 |
| `src/content/github-dom.test.ts` | DOM 検出のテスト（happy-dom） |
| `src/content/preview-button.ts` | Preview ボタンの生成・挿入・重複防止・状態管理 |
| `src/content/preview-button.test.ts` | ボタン挿入のテスト |
| `src/content/html-fetcher.ts` | raw HTML の fetch + Blob 化 + window.open |
| `src/content/html-fetcher.test.ts` | fetch フローのテスト（モック） |
| `src/content/observer.ts` | MutationObserver + debounce |
| `src/content/observer.test.ts` | Observer のテスト |
| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
| `src/content/viewport-toggle.ts` | Phase 3: viewport 切替 UI |
| `src/content/viewport-toggle.test.ts` | Phase 3: viewport 切替のテスト |
| `src/content/batch-preview.ts` | Phase 3: 一括プレビュー |
| `src/content/batch-preview.test.ts` | Phase 3: 一括プレビューのテスト |

---

## 4. Phase 1 (MVP) 実装詳細

### 4.1 DOM セレクタ戦略

GitHub PR の Files changed タブのファイルヘッダ検出は、複数セレクタでフォールバックする:

```typescript
const FILE_HEADER_SELECTORS = [
  '[data-tagsearch-path]',           // data属性ベース（最安定）
  '.file-header[data-path]',         // クラス + data属性
  '.file-header',                    // クラスのみ（フォールバック）
  'div[id^="diff-"]',               // diff コンテナ
] as const;
```

パス取得も複数戦略でフォールバック:

```typescript
const FILE_PATH_EXTRACTORS = [
  (el: Element) => el.getAttribute('data-tagsearch-path'),
  (el: Element) => el.getAttribute('data-path'),
  (el: Element) => el.querySelector('[title]')?.getAttribute('title'),
] as const;
```

検出優先順位: `data-*` 属性 > `data-testid` > クラス名。

### 4.2 URL 変換

"View file" リンクの href を raw URL に変換する:

```
入力: /owner/repo/blob/{sha_or_branch}/{path}
出力: /owner/repo/raw/{sha_or_branch}/{path}

変換: "/blob/" -> "/raw/" の単純置換
```

`github.com` ドメインを付与した完全 URL で fetch する。日本語・スペース・特殊文字はブラウザが自動エンコードするが、`encodeURI` で正規化する。

また、ファイルヘッダから直接 raw URL を構築するパターンも用意:

```typescript

exec
/bin/bash -lc "sed -n '1,220p' /workspace/.specs/001-html-preview/plan-review/review-002.md" in /workspace
 succeeded in 0ms:
OpenAI Codex v0.117.0 (research preview)
--------
workdir: /workspace
model: gpt-5.4
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 019d5d21-a8ff-7a91-baf7-367db06cd9e6
--------
user
以下の実装計画をレビューしてください。

【重要】ファイルの作成・編集は一切行わないでください。レビュー結果は標準出力のみで回答してください。

レビュー対象: .specs/001-html-preview/implementation-plan.md

前回のレビュー (plan-review/review-001.md) で以下の指摘があり、修正済みです:
1. セキュリティ方針の明文化（動的実行許可 + noopener + sandbox 制限）
2. 相対パス解決（<base> タグ注入）
3. ポップアップブロック回避（空タブを同期的に開く + document.write）
4. matches 拡大（/pull/* + runtime 判定 + turbo:load/popstate 対応）
5. URL ソースの一本化（View file リンクの href のみ使用）
6. DOM セレクタの整理（div[id^="diff-"] 除外、data-testid 不整合修正）

レビュー観点:
1. 前回の指摘が適切に反映されているか
2. 新たな仕様の曖昧さ・抜け漏れはないか
3. 実装可能性に問題はないか
4. エッジケースは考慮されているか
5. 全体アーキテクチャとの整合性はあるか

問題がなければ「問題なし」と回答してください。
問題があれば具体的な指摘と改善案を提示してください。
warning: Codex could not find system bubblewrap at /usr/bin/bwrap. Please install bubblewrap with your package manager. Codex will use the vendored bubblewrap in the meantime.
codex
レビュー対象と前回指摘の反映状況を確認します。まず計画書と前回レビューを読み、差分観点で曖昧さ・実装不能要素・抜けを洗います。
exec
/bin/bash -lc "sed -n '1,260p' /workspace/.specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
# Implementation Plan: GitHub PR HTML Preview

## 1. 概要

GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。

### スコープ

- **Phase 1 (MVP)**: Preview ボタン表示 + 新規タブプレビュー + MutationObserver
- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、テーマ対応、debounce
- **Phase 3 (拡張)**: インライン iframe、viewport 切替、一括プレビュー、blob/ ページ対応

### 前提

- plan.md ではユーザースクリプト形式だが、Chrome 拡張 (Manifest V3) として実装する
- コンテンツスクリプトは IIFE 必須（Vite でバンドル。ソースでは import 可能）
- 認証はブラウザセッションクッキー（`credentials: 'include'`）、PAT 不使用

### セキュリティ方針

- **プレビューは動的実行を許可する**: 教育 HTML のクイズ JS 等を動作確認する用途のため、script 実行を制限しない
- **`window.open` には `noopener` を指定**: opener への参照を遮断する
- **Phase 3 の iframe は `sandbox="allow-scripts"`**: `allow-same-origin` は付与しない（Blob URL のため不要）
- **ユーザーが意図的にプレビューする操作フロー**のため、untrusted HTML の実行リスクはユーザー判断に委ねる

### 相対パス解決方針

- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
- **Phase 1**: `<base href>` タグを HTML の `<head>` に注入し、raw URL のディレクトリを基準 URL とする
- 注入する base URL: `https://github.com/{owner}/{repo}/raw/{sha}/{dir}/`
- これにより `./style.css` 等の相対参照が raw URL 経由で解決される

---

## 2. システム図

### 2.1 状態マシン図（コンテンツスクリプトのライフサイクル）

```
                          +-----------+
                          |   IDLE    |
                          | (初期状態) |
                          +-----+-----+
                                |
                          page load / document_end
                                |
                                v
                    +---------------------+
                    |   OBSERVING         |
                    | MutationObserver    |
                    | 起動 + 初回スキャン   |
                    +-----+--------+------+
                          |        ^
                 DOM変更検出 |        | debounce 後に再監視
                          v        |
                  +----------------+------+
                  |  SCANNING             |
                  |  ファイルヘッダ検出     |
                  |  (.html判定)           |
                  +---+------+------+-----+
                      |      |      |
            HTML なし  |      |      | エラー（DOM構造変更）
            +---------+      |      +----------+
            |                |                 |
            v                v                 v
     (OBSERVING       +------------+    +-----------+
      に戻る)         | INSERTING  |    |   ERROR   |
                      | ボタン挿入  |    | ログ出力   |
                      +-----+------+    +-----+-----+
                            |                 |
                            v                 v
                      +------------+    (OBSERVING
                      |  WAITING   |     に戻る)
                      | クリック待ち |
                      +-----+------+
                            |
                      ユーザーがクリック
                            |
                            v
                      +------------+
                      |  FETCHING  |
                      | raw HTML   |
                      | fetch 実行  |
                      +-----+------+
                            |
                +-----------+-----------+
                |                       |
          成功 (200)              失敗 / タイムアウト
                |                       |
                v                       v
         +-------------+        +--------------+
         |  PREVIEWING |        | FETCH_ERROR  |
         | Blob生成     |        | ボタンに      |
         | 新規タブ表示  |        | エラー表示    |
         +------+------+        +------+-------+
                |                       |
                v                       v
          (WAITING                (WAITING
           に戻る)                 に戻る)
```

### 2.2 データフロー図

#### Phase 1-2: 新規タブプレビュー

```
+----------+     click      +------------------+     fetch      +----------------+
|  User    +--------------->| Content Script   +--------------->| github.com     |
|          |                | (content.ts)     |  credentials:  | /raw/refs/     |
+----------+                +--------+---------+  include       | heads/{branch} |
                                     |                          | /{path}        |
                                     |                          +-------+--------+
                                     |                                  |
                                     |                          302 redirect
                                     |                                  |
                                     |                                  v
                                     |                          +----------------+
                                     |                          | raw.github     |
                                     |            response      | usercontent    |
                                     |<-------------------------+ .com           |
                                     |            (HTML text)   +----------------+
                                     |
                                     | new Blob([html], {type: 'text/html'})
                                     | URL.createObjectURL(blob)
                                     |
                                     v
                              +------+-------+
                              | window.open  |
                              | (blob:// URL)|
                              | 新規タブ      |
                              +--------------+
```

#### Phase 3: インライン iframe プレビュー

```
+----------+     click      +------------------+     fetch      +----------------+
|  User    +--------------->| Content Script   +--------------->| github.com     |
|          |                | (content.ts)     |                | /raw/...       |
+----+-----+                +--------+---------+                +-------+--------+
     |                               |                                  |
     |                               |<---------------------------------+
     |                               |  response (HTML text)
     |                               |
     |                               | new Blob([html], {type: 'text/html'})
     |                               | URL.createObjectURL(blob)
     |                               |
     |                               v
     |                      +--------+---------+
     |                      | <iframe>         |
     |    viewport toggle   | diff 直下に挿入   |
     +--------------------->| src=blob:// URL  |
     |   320px / 768px /    +--------+---------+
     |   100%                        |
     |                               |
     |   "Open all HTML"             v
     +------------------------> 一括プレビュー
         PRヘッダの                  (全 .html ファイルを
         ボタンから                   順次 fetch + iframe)
```

---

## 3. ファイル構成

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `public/manifest.json` | `name`, `description`, `matches`（`/pull/*` に拡大）, `permissions` の更新 |
| `src/content.ts` | エントリポイントとして各モジュールを統合 |
| `src/background.ts` | 必要に応じて設定管理を追加 |
| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |

### 新規ファイル

| ファイル | 責務 |
|---------|------|
| `src/content/types.ts` | 共通型定義（ButtonState, FileHeaderInfo 等） |

codex
計画書の後半と実リポジトリ構成も照合します。特に `background.ts` の必要性、テスト配置、既存エントリとの整合を見ます。
exec
/bin/bash -lc "sed -n '521,820p' /workspace/.specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:

- **ランナー**: Vitest
- **DOM 環境**: happy-dom
- **モック基盤**: `src/test/setup.ts` で Chrome API + ブラウザ API をモック
- **方針**: TDD（Red-Green-Refactor サイクル）

### 7.2 追加モック（setup.ts に追加）

```typescript
// fetch モック
vi.stubGlobal('fetch', vi.fn());

// Blob URL
const originalURL = globalThis.URL;
vi.stubGlobal('URL', {
  ...originalURL,
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});

// window.open
vi.stubGlobal('open', vi.fn());
```

### 7.3 機能タイプ分類とテストパターン

| 機能タイプ | テスト方法 | 対象モジュール |
|-----------|-----------|--------------|
| 純粋関数 | 入力 -> 出力の検証。DOM 不要 | url-utils, debounce |
| DOM 検出 | happy-dom で GitHub 風 DOM を構築 -> 関数実行 -> 結果検証 | github-dom |
| DOM 操作 | happy-dom で DOM 構築 -> 操作実行 -> DOM 状態検証 | preview-button, iframe-preview, viewport-toggle |
| 非同期 I/O | fetch モック -> 関数実行 -> モック呼び出し検証 | html-fetcher |
| Observer | happy-dom の DOM 変更トリガー -> コールバック検証 | observer |
| 統合 | 上記を組み合わせたフロー検証 | content.ts |

### 7.4 テスト順序（TDD サイクル）

```
Phase 1:
  1. url-utils.test.ts        <-- 純粋関数（最もテストしやすい）
  2. github-dom.test.ts       <-- DOM 検出（happy-dom）
  3. preview-button.test.ts   <-- DOM 操作
  4. html-fetcher.test.ts     <-- fetch モック
  5. observer.test.ts         <-- MutationObserver

Phase 2:
  6. エラーハンドリングのテスト追加（html-fetcher.test.ts 拡張）
  7. Blob URL 解放のテスト追加（html-fetcher.test.ts 拡張）
  8. debounce ユーティリティのテスト（observer.test.ts 拡張）
  9. テーマ検出のテスト（github-dom.test.ts 拡張）

Phase 3:
  10. iframe-preview.test.ts
  11. viewport-toggle.test.ts
  12. batch-preview.test.ts
```

### 7.5 テストパターン詳細

**純粋関数テスト（url-utils）**:
- 正常系: `/blob/` -> `/raw/` 変換
- 日本語パス、スペース、特殊文字
- 不正な URL（/blob/ を含まない）

**DOM 検出テスト（github-dom）**:
- 各セレクタパターンでのファイルヘッダ検出
- .html ファイルのフィルタリング
- セレクタフォールバック

**DOM 操作テスト（preview-button）**:
- ボタン生成の属性・クラス検証
- 挿入位置の検証
- 重複防止

**非同期 I/O テスト（html-fetcher）**:
- fetch 成功 -> Blob 生成 -> window.open 呼び出し
- fetch 失敗（ネットワークエラー、401、403、500）
- セッション切れ（リダイレクト先がログインページ）

---

## 8. 技術的制約とリスク対策

| リスク | 影響度 | 対策 |
|-------|--------|------|
| GitHub DOM 構造変更 | 高 | 複数セレクタでフォールバック。`data-*` 属性優先 |
| セッション切れ | 中 | fetch レスポンスのステータスコード + URL 判定。ユーザー通知 |
| 大きな HTML ファイル | 低 | Blob 化は数百 KB でも問題なし。ローディング表示で UX 担保 |
| CSP 制約 | 低 | Blob URL は CSP 制約を受けにくい（検証済み） |
| 日本語/特殊文字パス | 中 | GitHub が href をエンコード済み。追加エンコード不要。テストケースに含める |
| Blob URL メモリリーク | 中 | タイマーベースの `revokeObjectURL` (30秒)。Phase 2 で対応 |
| MutationObserver 過剰発火 | 中 | debounce (150ms)。Phase 2 で対応 |
| コンテンツスクリプト IIFE 制約 | 低 | Vite がバンドル時に解決。ソースでは import 可能 |
| 相対パス（CSS/JS/画像）の解決 | 高 | `<base href>` タグを HTML に注入し、raw URL ディレクトリを基準 URL とする |
| ポップアップブロック | 高 | クリック直後に空タブを同期的に開き、fetch 後に document.write で書き込む |
| PJAX/Turbo 遷移 | 高 | `matches` を `/pull/*` に広げ、runtime で Files changed タブを判定。`turbo:load` + `popstate` イベント監視 |
| 外部 CDN 依存の JS | 低 | 通常通り CORS/CSP に従う。個別対応 |

---

## 9. Definition of Done

### Phase 1 (MVP)

- [ ] `public/manifest.json` の matches が `https://github.com/*/pull/*` に設定されている
- [ ] Files changed タブの runtime 判定が動作する（PJAX/Turbo 遷移対応）
- [ ] `.html` ファイルのヘッダに「Preview」ボタンが表示される
- [ ] ボタンクリックで新規タブに HTML がレンダリングされる（ポップアップブロック回避済み）
- [ ] 相対パス（CSS/JS/画像）が `<base>` タグ注入により正しく解決される
- [ ] 遅延読み込みされた diff にもボタンが挿入される（MutationObserver）
- [ ] 重複ボタンが挿入されない
- [ ] url-utils, github-dom, preview-button, html-fetcher, observer の全ユニットテストが Green
- [ ] `pnpm build` が成功する
- [ ] 3 ファイル以上の HTML を含む PR で動作確認

### Phase 2 (堅牢化)

- [ ] fetch 失敗時にボタン上にエラーメッセージが表示される
- [ ] セッション切れが検知・通知される
- [ ] Blob URL が 30 秒後に自動解放される
- [ ] ダーク/ライトテーマでボタンスタイルが適切
- [ ] MutationObserver が debounce (150ms) されている
- [ ] 折り畳まれた diff でもボタンが機能する
- [ ] エラーハンドリングのテストが通る
- [ ] 10 ファイル以上の PR で動作確認

### Phase 3 (拡張)

- [ ] diff 下部にインライン iframe でプレビュー表示可能
- [ ] iframe のリサイズ（ドラッグ）が可能
- [ ] Desktop/Tablet/Mobile の viewport 切替が動作する
- [ ] PR ヘッダに「Preview All HTML」ボタンが表示される
- [ ] `/blob/` ページでも Preview ボタンが表示される
- [ ] 各拡張機能のテストが通る

exec
/bin/bash -lc "rg --files /workspace | rg '"'^(public/manifest'"\\.json|src/content\\.ts|src/background\\.ts|src/test/setup\\.ts|vite|package\\.json|tsconfig|src/)'" in /workspace
 exited 1 in 0ms:
exec
/bin/bash -lc "sed -n '1,220p' /workspace/package.json" in /workspace
 succeeded in 0ms:
{
  "name": "github-html-preview-extension",
  "version": "0.1.0",
  "description": "github-html-preview-extension",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build && vite build -c vite.content.config.ts",
    "preview": "vite preview",
    "test": "vitest"
  },
  "keywords": [
    "chrome-extension",
    "template"
  ],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "react": "^19.2.3",
    "react-dom": "^19.2.3"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.0",
    "@types/chrome": "^0.0.268",
    "@types/node": "^25.0.3",
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.2",
    "@vitest/coverage-v8": "^4.0.16",
    "happy-dom": "^20.0.10",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5",
    "vite": "^7.3.0",
    "vitest": "^4.0.16"
  }
}

codex
既存構成をもう少し確認します。実ファイルの有無とビルド入口が計画どおりかを見て、計画の前提にズレがないか判断します。
exec
/bin/bash -lc "find /workspace -maxdepth 3 \\( -path '/workspace/node_modules' -o -path '/workspace/.git' \\) -prune -o -type f | sed 's#"'^/workspace/##'"' | sort | sed -n '1,260p'" in /workspace
 succeeded in 0ms:
.claude/settings.local.json
.devcontainer/.init-done
.devcontainer/devcontainer.json
.devcontainer/docker-compose.yml
.devcontainer/node/Dockerfile
.git
.gitignore
.npmrc
.playwright/cli.config.json
.specs/.guard/54795975-1484-45e6-8c61-5c12a4c452d6
.specs/001-html-preview/PLANNING
.specs/001-html-preview/exploration-report.md
.specs/001-html-preview/hearing-notes.md
.specs/001-html-preview/implementation-plan.md
.specs/001-html-preview/tasks.md
CLAUDE.md
LICENSE
README.md
docs/plan.md
node_modules
package.json
pnpm-lock.yaml
postcss.config.js
public/manifest.json
src/background.ts
src/content.ts
src/index.css
src/options/App.tsx
src/options/index.html
src/options/index.tsx
src/test/setup.ts
tailwind.config.js
tsconfig.app.json
tsconfig.base.json
tsconfig.json
tsconfig.node.json
tsconfig.test.json
vite.config.ts
vite.content.config.ts
vitest.config.ts

exec
/bin/bash -lc "sed -n '1,220p' /workspace/public/manifest.json" in /workspace
 succeeded in 0ms:
{
  "manifest_version": 3,
  "name": "Chrome Extension Template",
  "version": "0.1.0",
  "description": "Chrome Extension Template",
  "permissions": [
    "storage"
  ],
  "background": {
    "service_worker": "assets/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": [
        "<all_urls>"
      ],
      "js": [
        "assets/content.js"
      ],
      "run_at": "document_end"
    }
  ],
  "options_page": "src/options/index.html",
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  }
}

exec
/bin/bash -lc "sed -n '1,220p' /workspace/src/content.ts" in /workspace
 succeeded in 0ms:
// Content script
// This script runs in the context of web pages

console.log('Content script loaded');

exec
/bin/bash -lc "sed -n '1,220p' /workspace/src/test/setup.ts" in /workspace
exec
/bin/bash -lc "sed -n '1,220p' /workspace/src/background.ts" in /workspace
 succeeded in 0ms:
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock chrome API
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    onInstalled: {
      addListener: vi.fn(),
    },
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  },
};

vi.stubGlobal('chrome', chromeMock);

 succeeded in 0ms:
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

exec
/bin/bash -lc "sed -n '1,220p' /workspace/vite.content.config.ts" in /workspace
 succeeded in 0ms:
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        format: 'iife',
        extend: true,
      },
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
  },
});

codex
指摘候補の位置を固めるため、該当箇所に行番号を付けて確認します。ここからは前回の修正反映だけでなく、今回残っている実装上の齟齬を絞ります。
exec
/bin/bash -lc "nl -ba /workspace/.specs/001-html-preview/implementation-plan.md | sed -n '1,260p'" in /workspace
 succeeded in 0ms:
     1	# Implementation Plan: GitHub PR HTML Preview
     2	
     3	## 1. 概要
     4	
     5	GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。
     6	
     7	### スコープ
     8	
     9	- **Phase 1 (MVP)**: Preview ボタン表示 + 新規タブプレビュー + MutationObserver
    10	- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、テーマ対応、debounce
    11	- **Phase 3 (拡張)**: インライン iframe、viewport 切替、一括プレビュー、blob/ ページ対応
    12	
    13	### 前提
    14	
    15	- plan.md ではユーザースクリプト形式だが、Chrome 拡張 (Manifest V3) として実装する
    16	- コンテンツスクリプトは IIFE 必須（Vite でバンドル。ソースでは import 可能）
    17	- 認証はブラウザセッションクッキー（`credentials: 'include'`）、PAT 不使用
    18	
    19	### セキュリティ方針
    20	
    21	- **プレビューは動的実行を許可する**: 教育 HTML のクイズ JS 等を動作確認する用途のため、script 実行を制限しない
    22	- **`window.open` には `noopener` を指定**: opener への参照を遮断する
    23	- **Phase 3 の iframe は `sandbox="allow-scripts"`**: `allow-same-origin` は付与しない（Blob URL のため不要）
    24	- **ユーザーが意図的にプレビューする操作フロー**のため、untrusted HTML の実行リスクはユーザー判断に委ねる
    25	
    26	### 相対パス解決方針
    27	
    28	- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
    29	- **Phase 1**: `<base href>` タグを HTML の `<head>` に注入し、raw URL のディレクトリを基準 URL とする
    30	- 注入する base URL: `https://github.com/{owner}/{repo}/raw/{sha}/{dir}/`
    31	- これにより `./style.css` 等の相対参照が raw URL 経由で解決される
    32	
    33	---
    34	
    35	## 2. システム図
    36	
    37	### 2.1 状態マシン図（コンテンツスクリプトのライフサイクル）
    38	
    39	```
    40	                          +-----------+
    41	                          |   IDLE    |
    42	                          | (初期状態) |
    43	                          +-----+-----+
    44	                                |
    45	                          page load / document_end
    46	                                |
    47	                                v
    48	                    +---------------------+
    49	                    |   OBSERVING         |
    50	                    | MutationObserver    |
    51	                    | 起動 + 初回スキャン   |
    52	                    +-----+--------+------+
    53	                          |        ^
    54	                 DOM変更検出 |        | debounce 後に再監視
    55	                          v        |
    56	                  +----------------+------+
    57	                  |  SCANNING             |
    58	                  |  ファイルヘッダ検出     |
    59	                  |  (.html判定)           |
    60	                  +---+------+------+-----+
    61	                      |      |      |
    62	            HTML なし  |      |      | エラー（DOM構造変更）
    63	            +---------+      |      +----------+
    64	            |                |                 |
    65	            v                v                 v
    66	     (OBSERVING       +------------+    +-----------+
    67	      に戻る)         | INSERTING  |    |   ERROR   |
    68	                      | ボタン挿入  |    | ログ出力   |
    69	                      +-----+------+    +-----+-----+
    70	                            |                 |
    71	                            v                 v
    72	                      +------------+    (OBSERVING
    73	                      |  WAITING   |     に戻る)
    74	                      | クリック待ち |
    75	                      +-----+------+
    76	                            |
    77	                      ユーザーがクリック
    78	                            |
    79	                            v
    80	                      +------------+
    81	                      |  FETCHING  |
    82	                      | raw HTML   |
    83	                      | fetch 実行  |
    84	                      +-----+------+
    85	                            |
    86	                +-----------+-----------+
    87	                |                       |
    88	          成功 (200)              失敗 / タイムアウト
    89	                |                       |
    90	                v                       v
    91	         +-------------+        +--------------+
    92	         |  PREVIEWING |        | FETCH_ERROR  |
    93	         | Blob生成     |        | ボタンに      |
    94	         | 新規タブ表示  |        | エラー表示    |
    95	         +------+------+        +------+-------+
    96	                |                       |
    97	                v                       v
    98	          (WAITING                (WAITING
    99	           に戻る)                 に戻る)
   100	```
   101	
   102	### 2.2 データフロー図
   103	
   104	#### Phase 1-2: 新規タブプレビュー
   105	
   106	```
   107	+----------+     click      +------------------+     fetch      +----------------+
   108	|  User    +--------------->| Content Script   +--------------->| github.com     |
   109	|          |                | (content.ts)     |  credentials:  | /raw/refs/     |
   110	+----------+                +--------+---------+  include       | heads/{branch} |
   111	                                     |                          | /{path}        |
   112	                                     |                          +-------+--------+
   113	                                     |                                  |
   114	                                     |                          302 redirect
   115	                                     |                                  |
   116	                                     |                                  v
   117	                                     |                          +----------------+
   118	                                     |                          | raw.github     |
   119	                                     |            response      | usercontent    |
   120	                                     |<-------------------------+ .com           |
   121	                                     |            (HTML text)   +----------------+
   122	                                     |
   123	                                     | new Blob([html], {type: 'text/html'})
   124	                                     | URL.createObjectURL(blob)
   125	                                     |
   126	                                     v
   127	                              +------+-------+
   128	                              | window.open  |
   129	                              | (blob:// URL)|
   130	                              | 新規タブ      |
   131	                              +--------------+
   132	```
   133	
   134	#### Phase 3: インライン iframe プレビュー
   135	
   136	```
   137	+----------+     click      +------------------+     fetch      +----------------+
   138	|  User    +--------------->| Content Script   +--------------->| github.com     |
   139	|          |                | (content.ts)     |                | /raw/...       |
   140	+----+-----+                +--------+---------+                +-------+--------+
   141	     |                               |                                  |
   142	     |                               |<---------------------------------+
   143	     |                               |  response (HTML text)
   144	     |                               |
   145	     |                               | new Blob([html], {type: 'text/html'})
   146	     |                               | URL.createObjectURL(blob)
   147	     |                               |
   148	     |                               v
   149	     |                      +--------+---------+
   150	     |                      | <iframe>         |
   151	     |    viewport toggle   | diff 直下に挿入   |
   152	     +--------------------->| src=blob:// URL  |
   153	     |   320px / 768px /    +--------+---------+
   154	     |   100%                        |
   155	     |                               |
   156	     |   "Open all HTML"             v
   157	     +------------------------> 一括プレビュー
   158	         PRヘッダの                  (全 .html ファイルを
   159	         ボタンから                   順次 fetch + iframe)
   160	```
   161	
   162	---
   163	
   164	## 3. ファイル構成
   165	
   166	### 変更ファイル
   167	
   168	| ファイル | 変更内容 |
   169	|---------|---------|
   170	| `public/manifest.json` | `name`, `description`, `matches`（`/pull/*` に拡大）, `permissions` の更新 |
   171	| `src/content.ts` | エントリポイントとして各モジュールを統合 |
   172	| `src/background.ts` | 必要に応じて設定管理を追加 |
   173	| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |
   174	
   175	### 新規ファイル
   176	
   177	| ファイル | 責務 |
   178	|---------|------|
   179	| `src/content/types.ts` | 共通型定義（ButtonState, FileHeaderInfo 等） |
   180	| `src/content/url-utils.ts` | URL 変換（blob -> raw）、`<base>` タグ注入。純粋関数 |
   181	| `src/content/url-utils.test.ts` | URL 変換のユニットテスト |
   182	| `src/content/github-dom.ts` | GitHub DOM セレクタ、ファイルヘッダ検出、HTML ファイル判定 |
   183	| `src/content/github-dom.test.ts` | DOM 検出のテスト（happy-dom） |
   184	| `src/content/preview-button.ts` | Preview ボタンの生成・挿入・重複防止・状態管理 |
   185	| `src/content/preview-button.test.ts` | ボタン挿入のテスト |
   186	| `src/content/html-fetcher.ts` | raw HTML の fetch + Blob 化 + window.open |
   187	| `src/content/html-fetcher.test.ts` | fetch フローのテスト（モック） |
   188	| `src/content/observer.ts` | MutationObserver + debounce |
   189	| `src/content/observer.test.ts` | Observer のテスト |
   190	| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
   191	| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
   192	| `src/content/viewport-toggle.ts` | Phase 3: viewport 切替 UI |
   193	| `src/content/viewport-toggle.test.ts` | Phase 3: viewport 切替のテスト |
   194	| `src/content/batch-preview.ts` | Phase 3: 一括プレビュー |
   195	| `src/content/batch-preview.test.ts` | Phase 3: 一括プレビューのテスト |
   196	
   197	---
   198	
   199	## 4. Phase 1 (MVP) 実装詳細
   200	
   201	### 4.1 DOM セレクタ戦略
   202	
   203	GitHub PR の Files changed タブのファイルヘッダ検出は、複数セレクタでフォールバックする:
   204	
   205	```typescript
   206	const FILE_HEADER_SELECTORS = [
   207	  '[data-tagsearch-path]',           // data属性ベース（最安定）
   208	  '.file-header[data-path]',         // クラス + data属性
   209	  '.file-header',                    // クラスのみ（フォールバック）
   210	] as const;
   211	```
   212	
   213	パス取得も複数戦略でフォールバック:
   214	
   215	```typescript
   216	const FILE_PATH_EXTRACTORS = [
   217	  (el: Element) => el.getAttribute('data-tagsearch-path'),
   218	  (el: Element) => el.getAttribute('data-path'),
   219	  (el: Element) => el.querySelector('[title]')?.getAttribute('title'),
   220	] as const;
   221	```
   222	
   223	検出優先順位: `data-*` 属性 > クラス名。`div[id^="diff-"]` は広すぎるため除外。
   224	
   225	**ページタイプ判定**: `matches` を `/pull/*` に広げるため、content script 内で URL パスから Files changed タブかどうかを runtime 判定する:
   226	
   227	```typescript
   228	function isFilesChangedTab(): boolean {
   229	  return /\/pull\/\d+\/files/.test(location.pathname);
   230	}
   231	```
   232	
   233	GitHub の PJAX/Turbo 遷移に対応するため、`popstate` イベントや `turbo:load` イベントも監視する。
   234	
   235	### 4.2 URL 変換
   236	
   237	**URL ソース**: "View file" リンク (`a[href*="/blob/"]`) の absolute href を唯一のソースとする。ファイルヘッダからの独自構築は行わない（fork PR やブランチ名に `/` を含むケースで壊れるため）。
   238	
   239	```
   240	入力: https://github.com/owner/repo/blob/{sha}/{path}
   241	出力: https://github.com/owner/repo/raw/{sha}/{path}
   242	
   243	変換: "/blob/" -> "/raw/" の単純置換
   244	```
   245	
   246	"View file" リンクが見つからないファイル（削除ファイル、rename の旧名側）は非対応とし、ボタンを挿入しない。
   247	
   248	特殊文字の扱い: ブラウザが href を自動エンコード済みのため、追加の `encodeURI` は不要。`#` や `?` を含むファイル名は href のパース時に壊れる可能性があるが、GitHub がそれらを適切にエンコードした href を生成するため問題なし。
   249	
   250	### 4.3 ボタン挿入
   251	
   252	```typescript
   253	// ボタンの識別用カスタム属性（重複防止）
   254	const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';
   255	
   256	// GitHub のボタンスタイルに合わせる
   257	const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
   258	```
   259	
   260	挿入位置: ファイルヘッダ内の `.file-actions` または `.file-info`、末尾にフォールバック。既存のアクションボタン群の隣に配置。

exec
/bin/bash -lc "nl -ba /workspace/.specs/001-html-preview/implementation-plan.md | sed -n '261,560p'" in /workspace
 succeeded in 0ms:
   261	
   262	重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。
   263	
   264	### 4.4 fetch + Blob + 新規タブ
   265	
   266	**ポップアップブロック回避**: `await fetch` 後の `window.open` はユーザー操作コンテキスト外となりブロックされる可能性がある。対策として、クリック直後に空タブを同期的に開き、fetch 完了後にそのタブに HTML を書き込む:
   267	
   268	```typescript
   269	async function fetchAndPreview(rawUrl: string): Promise<void> {
   270	  // クリックイベント内で同期的にタブを開く（ポップアップブロック回避）
   271	  const newTab = window.open('about:blank', '_blank', 'noopener');
   272	  if (!newTab) throw new Error('Popup blocked');
   273	
   274	  const response = await fetch(rawUrl, { credentials: 'include' });
   275	  if (!response.ok) {
   276	    newTab.close();
   277	    throw new Error(`HTTP ${response.status}`);
   278	  }
   279	  const html = await response.text();
   280	
   281	  // <base> タグを注入して相対パスを解決
   282	  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
   283	  const htmlWithBase = injectBaseTag(html, baseUrl);
   284	
   285	  newTab.document.open();
   286	  newTab.document.write(htmlWithBase);
   287	  newTab.document.close();
   288	}
   289	
   290	function injectBaseTag(html: string, baseUrl: string): string {
   291	  // <head> タグの直後に <base> を挿入
   292	  if (html.includes('<head>')) {
   293	    return html.replace('<head>', `<head><base href="${baseUrl}">`);
   294	  }
   295	  if (html.includes('<head ')) {
   296	    return html.replace(/<head\s[^>]*>/, `$&<base href="${baseUrl}">`);
   297	  }
   298	  // <head> がない場合は先頭に追加
   299	  return `<base href="${baseUrl}">${html}`;
   300	}
   301	```
   302	
   303	### 4.5 MutationObserver
   304	
   305	GitHub PR は diff を遅延読み込みするため、DOM 変更を監視してボタンを挿入する。また、GitHub の PJAX/Turbo 遷移にも対応:
   306	
   307	```typescript
   308	const observer = new MutationObserver(() => {
   309	  if (isFilesChangedTab()) {
   310	    addPreviewButtons();
   311	  }
   312	});
   313	
   314	observer.observe(document.body, {
   315	  childList: true,
   316	  subtree: true,
   317	});
   318	
   319	// PJAX/Turbo 遷移対応
   320	document.addEventListener('turbo:load', () => {
   321	  if (isFilesChangedTab()) addPreviewButtons();
   322	});
   323	window.addEventListener('popstate', () => {
   324	  if (isFilesChangedTab()) addPreviewButtons();
   325	});
   326	
   327	// 初回スキャン
   328	if (isFilesChangedTab()) addPreviewButtons();
   329	```
   330	
   331	---
   332	
   333	## 5. Phase 2 (堅牢化) 実装詳細
   334	
   335	### 5.1 エラーハンドリング
   336	
   337	fetch 失敗時のユーザーフィードバック:
   338	
   339	```
   340	+------------------+     +-------------------+     +------------------+
   341	| fetch 実行       | --> | レスポンス判定     | --> | 成功: プレビュー  |
   342	+------------------+     +---+---------------+     +------------------+
   343	                             |
   344	                             | 失敗
   345	                             v
   346	                   +---------+----------+
   347	                   | エラー種別判定      |
   348	                   +--+------+------+---+
   349	                      |      |      |
   350	                      v      v      v
   351	                  network  401/   その他
   352	                  error    403
   353	                      |      |      |
   354	                      v      v      v
   355	                  "Network "Session "Preview
   356	                   error"  expired" failed"
   357	```
   358	
   359	ボタンの状態管理:
   360	
   361	```typescript
   362	type ButtonState = 'idle' | 'loading' | 'error';
   363	```
   364	
   365	ボタンのテキストを一時的にエラーメッセージに変更し、3秒後に復帰する。
   366	
   367	セッション切れ検知: レスポンスの URL がログインページにリダイレクトされた場合を判定。
   368	
   369	### 5.2 Blob URL 解放
   370	
   371	```typescript
   372	const BLOB_URL_LIFETIME_MS = 30_000; // 30秒
   373	
   374	// 既存 Blob URL の管理マップ
   375	const blobUrls: Map<string, { url: string; createdAt: number }> = new Map();
   376	
   377	function createManagedBlobUrl(blob: Blob, key: string): string {
   378	  // 既存の Blob URL があれば解放
   379	  const existing = blobUrls.get(key);
   380	  if (existing) URL.revokeObjectURL(existing.url);
   381	
   382	  const url = URL.createObjectURL(blob);
   383	  blobUrls.set(key, { url, createdAt: Date.now() });
   384	
   385	  setTimeout(() => {
   386	    URL.revokeObjectURL(url);
   387	    blobUrls.delete(key);
   388	  }, BLOB_URL_LIFETIME_MS);
   389	
   390	  return url;
   391	}
   392	```
   393	
   394	### 5.3 テーマ対応
   395	
   396	GitHub の `data-color-mode` 属性と既存 CSS 変数を活用:
   397	
   398	```typescript
   399	function getTheme(): 'light' | 'dark' {
   400	  return document.documentElement.getAttribute('data-color-mode') === 'dark'
   401	    ? 'dark' : 'light';
   402	}
   403	```
   404	
   405	GitHub ネイティブの `btn` クラスを使うことで基本的に自動追従する。カスタムスタイルが必要な場合のみ `--color-btn-bg`, `--color-btn-text` 等の CSS 変数を参照。
   406	
   407	### 5.4 debounce
   408	
   409	MutationObserver の過剰発火を抑制:
   410	
   411	```typescript
   412	function debounce<T extends (...args: unknown[]) => void>(
   413	  fn: T,
   414	  delay: number
   415	): T {
   416	  let timer: ReturnType<typeof setTimeout> | null = null;
   417	  return ((...args: unknown[]) => {
   418	    if (timer) clearTimeout(timer);
   419	    timer = setTimeout(() => fn(...args), delay);
   420	  }) as T;
   421	}
   422	
   423	// 使用: 150ms debounce
   424	const debouncedAddButtons = debounce(addPreviewButtons, 150);
   425	const observer = new MutationObserver(debouncedAddButtons);
   426	```
   427	
   428	### 5.5 折り畳み対応
   429	
   430	diff が collapsed 状態のファイルにもボタンを挿入。ファイルヘッダは折り畳み時も表示されるため、通常のセレクタで対応可能。
   431	
   432	---
   433	
   434	## 6. Phase 3 (拡張) 実装詳細
   435	
   436	### 6.1 インライン iframe プレビュー
   437	
   438	diff ブロックの直下に iframe を挿入:
   439	
   440	```typescript
   441	function createInlinePreview(
   442	  container: Element,
   443	  blobUrl: string,
   444	  viewportWidth: string
   445	): HTMLIFrameElement {
   446	  const iframe = document.createElement('iframe');
   447	  iframe.src = blobUrl;
   448	  iframe.style.cssText = `
   449	    width: ${viewportWidth};
   450	    height: 400px;
   451	    border: 1px solid var(--color-border-default);
   452	    border-radius: 6px;
   453	    resize: vertical;
   454	    overflow: auto;
   455	  `;
   456	  iframe.setAttribute('sandbox', 'allow-scripts');
   457	  container.appendChild(iframe);
   458	  return iframe;
   459	}
   460	```
   461	
   462	トグル動作: 「Inline Preview」ボタンをクリックで展開/折り畳み。
   463	
   464	### 6.2 viewport 切替
   465	
   466	```
   467	+------------------------------------------+
   468	| [Mobile 375px] [Tablet 768px] [Desktop]  |  <-- 切替 UI
   469	+------------------------------------------+
   470	| +--------------------------------------+ |
   471	| |          iframe preview              | |
   472	| |      (width 動的変更)                 | |
   473	| +--------------------------------------+ |
   474	+------------------------------------------+
   475	```
   476	
   477	プリセット:
   478	
   479	```typescript
   480	const VIEWPORTS = {
   481	  mobile:  { width: '375px',  label: 'Mobile' },
   482	  tablet:  { width: '768px',  label: 'Tablet' },
   483	  desktop: { width: '100%',   label: 'Desktop' },
   484	} as const;
   485	```
   486	
   487	### 6.3 一括プレビュー
   488	
   489	PR ヘッダ付近に「Preview all HTML files」ボタンを追加:
   490	
   491	```typescript
   492	async function previewAllHtml(): Promise<void> {
   493	  const htmlHeaders = findAllHtmlFileHeaders();
   494	  for (const header of htmlHeaders) {
   495	    const rawUrl = getRawUrlFromHeader(header);
   496	    if (rawUrl) await fetchHtmlAndOpen(rawUrl);
   497	  }
   498	}
   499	```
   500	
   501	### 6.4 blob/ ページ対応
   502	
   503	manifest.json の matches を拡張:
   504	
   505	```json
   506	{
   507	  "matches": [
   508	    "https://github.com/*/pull/*",
   509	    "https://github.com/*/blob/*/*.html"
   510	  ]
   511	}
   512	```
   513	
   514	`/blob/` ページでは既存の "Raw" ボタンの隣に "Preview" を追加。ページタイプに応じたセレクタを使い分け。
   515	
   516	---
   517	
   518	## 7. テスト戦略
   519	
   520	### 7.1 テスト環境
   521	
   522	- **ランナー**: Vitest
   523	- **DOM 環境**: happy-dom
   524	- **モック基盤**: `src/test/setup.ts` で Chrome API + ブラウザ API をモック
   525	- **方針**: TDD（Red-Green-Refactor サイクル）
   526	
   527	### 7.2 追加モック（setup.ts に追加）
   528	
   529	```typescript
   530	// fetch モック
   531	vi.stubGlobal('fetch', vi.fn());
   532	
   533	// Blob URL
   534	const originalURL = globalThis.URL;
   535	vi.stubGlobal('URL', {
   536	  ...originalURL,
   537	  createObjectURL: vi.fn(() => 'blob:mock-url'),
   538	  revokeObjectURL: vi.fn(),
   539	});
   540	
   541	// window.open
   542	vi.stubGlobal('open', vi.fn());
   543	```
   544	
   545	### 7.3 機能タイプ分類とテストパターン
   546	
   547	| 機能タイプ | テスト方法 | 対象モジュール |
   548	|-----------|-----------|--------------|
   549	| 純粋関数 | 入力 -> 出力の検証。DOM 不要 | url-utils, debounce |
   550	| DOM 検出 | happy-dom で GitHub 風 DOM を構築 -> 関数実行 -> 結果検証 | github-dom |
   551	| DOM 操作 | happy-dom で DOM 構築 -> 操作実行 -> DOM 状態検証 | preview-button, iframe-preview, viewport-toggle |
   552	| 非同期 I/O | fetch モック -> 関数実行 -> モック呼び出し検証 | html-fetcher |
   553	| Observer | happy-dom の DOM 変更トリガー -> コールバック検証 | observer |
   554	| 統合 | 上記を組み合わせたフロー検証 | content.ts |
   555	
   556	### 7.4 テスト順序（TDD サイクル）
   557	
   558	```
   559	Phase 1:
   560	  1. url-utils.test.ts        <-- 純粋関数（最もテストしやすい）

web search: 
web search: MDN window.open noopener returns null
web search: 
web search: https://developer.mozilla.org/en-US/docs/Web/API/Window/open
codex
前提調査の記録にも当たり、今回の候補が既知前提と矛盾しないかを確認します。とくに raw 取得経路とプレビュー方式の扱いは、探索結果と合わせて見ます。
exec
/bin/bash -lc "sed -n '1,240p' /workspace/.specs/001-html-preview/exploration-report.md" in /workspace
exec
/bin/bash -lc 'rg -n "noopener|window.open|raw/|blob URL|base href|Preview all|sandbox" /workspace/.specs/001-html-preview/exploration-report.md /workspace/docs/plan.md /workspace/.specs/001-html-preview/hearing-notes.md' in /workspace
 succeeded in 0ms:
# Exploration Report: GitHub PR HTML Preview

## 1. アーキテクチャ概要

### ディレクトリ構造

```
/workspace/
├── public/
│   └── manifest.json          # Chrome拡張マニフェスト (Manifest V3)
├── src/
│   ├── background.ts          # サービスワーカー (スケルトン)
│   ├── content.ts             # コンテンツスクリプト (スケルトン)
│   ├── index.css              # Tailwind CSS + デザイントークン (ライト/ダーク)
│   ├── options/
│   │   ├── App.tsx            # React 19 オプションページコンポーネント
│   │   ├── index.html         # オプションページHTML
│   │   └── index.tsx          # React エントリポイント
│   └── test/
│       └── setup.ts           # Vitest セットアップ (Chrome API モック)
├── docs/
│   └── plan.md                # Violentmonkey版の実装計画 (参考・骨格コード含む)
├── vite.config.ts             # メインViteビルド (background + options, ESモジュール)
├── vite.content.config.ts     # コンテンツスクリプトViteビルド (IIFE)
├── vitest.config.ts           # テスト設定 (happy-dom)
├── tsconfig.json              # プロジェクトルート (references方式: app, test, node)
├── tsconfig.base.json         # 共通TypeScript設定 (ES2020, strict, react-jsx)
├── tsconfig.app.json          # アプリ用 (types: chrome, vite/client)
├── tsconfig.test.json         # テスト用 (types: chrome, vite/client, vitest, node)
├── tsconfig.node.json         # Node用 (vite.config.ts, vitest.config.ts)
├── tailwind.config.js         # Tailwind CSS設定
├── postcss.config.js          # PostCSS設定
└── package.json               # pnpm プロジェクト (type: module)
```

### ビルドフロー

`pnpm build` は以下を順次実行:

```
tsc (型チェック)
  → vite build (vite.config.ts)
      入力: src/background.ts, src/options/index.html
      出力: dist/ (emptyOutDir: true でクリア)
      形式: ES module
      出力名: dist/assets/background.js, dist/assets/options.js + HTML
  → vite build -c vite.content.config.ts
      入力: src/content.ts
      出力: dist/ (emptyOutDir: false で追加)
      形式: IIFE
      出力名: dist/assets/content.js
```

## 2. 関連コード分析

### src/content.ts -- コンテンツスクリプト (現状スケルトン)

```typescript
// Content script
// This script runs in the context of web pages

console.log('Content script loaded');
```

完全にスケルトン状態。hearing-notesで要求されている DOM 操作 (Preview ボタン追加、MutationObserver、fetch + Blob URL) は全て新規実装が必要。

### src/background.ts -- バックグラウンドサービスワーカー (現状スケルトン)

```typescript
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});
```

`onInstalled` リスナーのみ。Phase 1 MVP ではバックグラウンドの拡張は不要と思われる。将来的にコンテキストメニューやタブ管理を追加する場合はここに実装する。

### public/manifest.json -- Chrome拡張マニフェスト (全文)

```json
{
  "manifest_version": 3,
  "name": "Chrome Extension Template",
  "version": "0.1.0",
  "description": "Chrome Extension Template",
  "permissions": ["storage"],
  "background": {
    "service_worker": "assets/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["assets/content.js"],
      "run_at": "document_end"
    }
  ],
  "options_page": "src/options/index.html",
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  }
}
```

変更必要箇所:
- `name`: "Chrome Extension Template" -> "GitHub PR HTML Preview"
- `description`: プロジェクト内容に合わせて更新
- `matches`: `<all_urls>` -> `https://github.com/*/pull/*/files` に限定
- `permissions`: `storage` は保持。fetch はコンテンツスクリプトの github.com オリジンで動作するため追加パーミッション不要

### vite.content.config.ts -- IIFE ビルド設定

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        format: 'iife',
        extend: true,
      },
    },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
  },
});
```

`format: 'iife'` + `emptyOutDir: false` でメインビルドの出力を保持しつつ content.js を追加。ソースコード上では通常の TypeScript import が使えるが、最終出力は単一 IIFE にバンドルされる。新規モジュールを `src/content.ts` から import してもそのまま動作する。

### vite.config.ts -- メインビルド設定

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        options: resolve(__dirname, 'src/options/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

### vitest.config.ts -- テスト設定

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
```

- `happy-dom` 環境: DOM 操作テスト (querySelector, createElement, MutationObserver) に対応
- `globals: true`: `describe`, `it`, `expect` がグローバル利用可能 (import 不要)
- テストファイルはソースと並置 (`src/**/*.test.ts`)

### src/test/setup.ts -- Chrome API モック (全文)

```typescript
import '@testing-library/jest-dom';
import { vi } from 'vitest';

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    onInstalled: {
      addListener: vi.fn(),
    },
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  },
};

vi.stubGlobal('chrome', chromeMock);
```

モック済み: `chrome.storage.local`, `chrome.storage.onChanged`, `chrome.runtime.onInstalled`, `chrome.contextMenus`。
Phase 1 MVP では `window.open` で新規タブを開くため Chrome API の追加モックは不要の可能性が高い。

### tsconfig.base.json -- TypeScript 共通設定

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "strict": true,
    "noUnusedLocals": true,

 succeeded in 0ms:
/workspace/.specs/001-html-preview/exploration-report.md:229:Phase 1 MVP では `window.open` で新規タブを開くため Chrome API の追加モックは不要の可能性が高い。
/workspace/.specs/001-html-preview/exploration-report.md:309:      const rawUrl = viewFileLink.href.replace("/blob/", "/raw/");
/workspace/.specs/001-html-preview/exploration-report.md:320:        window.open(URL.createObjectURL(blob), "_blank");
/workspace/.specs/001-html-preview/exploration-report.md:333:raw URL 形式: `github.com/{owner}/{repo}/raw/refs/heads/{branch}/{path}` (セッションクッキー経由で認証 -> `raw.githubusercontent.com` にリダイレクト)
/workspace/.specs/001-html-preview/exploration-report.md:355:- raw URL 形式: `/blob/{sha}/{path}` -> `/raw/{sha}/{path}` に置換
/workspace/.specs/001-html-preview/exploration-report.md:380:| `src/html-preview/url.ts` | URL 変換 (/blob/ -> /raw/) |
/workspace/.specs/001-html-preview/exploration-report.md:413:   - URL 変換: `/blob/` -> `/raw/` 置換
/workspace/.specs/001-html-preview/exploration-report.md:424:   - fetch -> Blob -> window.open のフロー
/workspace/.specs/001-html-preview/exploration-report.md:438:// window.open モック
/workspace/.specs/001-html-preview/exploration-report.md:478:4. `preview.ts` + テスト: fetch + Blob URL + window.open
/workspace/.specs/001-html-preview/exploration-report.md:489:- `window.open` はコンテンツスクリプトから直接呼び出し可能 (chrome.tabs.create 不要)
/workspace/.specs/001-html-preview/hearing-notes.md:27:- **raw URL 形式**: `github.com/{owner}/{repo}/raw/refs/heads/{branch}/{path}` → セッションクッキー経由で認証 → `raw.githubusercontent.com` にリダイレクト
/workspace/docs/plan.md:20:`github.com/{owner}/{repo}/raw/refs/heads/{branch}/{path}` に対して `fetch(url, { credentials: 'include' })` を実行すると、セッションクッキー経由で認証され、短命トークン付きの `raw.githubusercontent.com` URL にリダイレクトされ、HTMLコンテンツが取得できることを確認済み。
/workspace/docs/plan.md:60:   - "View file" リンクの href(`/blob/{sha}/{path}`)を `/raw/{sha}/{path}` に置換
/workspace/docs/plan.md:62:   - `Blob` 化して `window.open` で新規タブに表示
/workspace/docs/plan.md:95:        const rawUrl = viewFileLink.href.replace("/blob/", "/raw/");
/workspace/docs/plan.md:106:          window.open(URL.createObjectURL(blob), "_blank");

web search: 
web search: MDN about:blank inherits CSP opener
web search: 
web search: https://w3c.github.io/webappsec-csp/
codex
前回の指摘 2-6 は概ね反映されています。ですが、1 は実装レベルでは未解決で、加えて新たなブロッカーが 1 点あります。

- 重大: 現在のプレビュー方式は GitHub 側 CSP の継承を前提としておらず、`動的実行を許可する` という要件と衝突しています。[implementation-plan.md:21](/workspace/.specs/001-html-preview/implementation-plan.md#L21) [implementation-plan.md:266](/workspace/.specs/001-html-preview/implementation-plan.md#L266) [implementation-plan.md:436](/workspace/.specs/001-html-preview/implementation-plan.md#L436)
  改善案: `about:blank` / `blob:` / `data:` のようなローカルスキームを使う前提をいったん設計上のリスクとして昇格し、GitHub の CSP を継承しないプレビュー面で本当に要件を満たせるかを先に検証してください。成立しない場合は、MVP 要件を「静的レンダリング確認」までに下げるか、別アーキテクチャに切り替える必要があります。

- 重大: `window.open('about:blank', '_blank', 'noopener')` と `newTab.document.write(...)` は両立しません。`noopener` を付けると戻り値ハンドルに依存する現在の実装は成立しません。[implementation-plan.md:22](/workspace/.specs/001-html-preview/implementation-plan.md#L22) [implementation-plan.md:269](/workspace/.specs/001-html-preview/implementation-plan.md#L269)
  改善案: `noopener` を維持するなら、書き込み可能な別方式に設計変更が必要です。逆に現在の `document.write` 方式を採るなら、`noopener` 方針をどう満たすかを別途明文化してください。

- 中: レンダリング方式がまだ文書内で混在しています。Phase 1-2 の図は Blob URL 前提ですが、本文は `about:blank + document.write` 前提です。また Phase 2 の Blob URL 解放は新規タブ方式では使われず、Phase 3 の一括プレビューは説明では iframe 群なのにサンプルコードは `fetchHtmlAndOpen()` を呼んでいます。[implementation-plan.md:106](/workspace/.specs/001-html-preview/implementation-plan.md#L106) [implementation-plan.md:264](/workspace/.specs/001-html-preview/implementation-plan.md#L264) [implementation-plan.md:369](/workspace/.specs/001-html-preview/implementation-plan.md#L369) [implementation-plan.md:492](/workspace/.specs/001-html-preview/implementation-plan.md#L492)
  改善案: フェーズごとに「どの描画面を使うか」を 1 つに固定し、図、本文、テスト、DoD を同じ前提にそろえてください。

参考:
- MDN `window.open`: `noopener` 指定時は `null` を返す旨 https://developer.mozilla.org/en-US/docs/Web/API/Window/open
- CSP Level 3: `about:blank` / `blob:` / `data:` / `document.write()` 可能な文書は元文書の CSP を継承 https://w3c.github.io/webappsec-csp/
tokens used
68,006
前回の指摘 2-6 は概ね反映されています。ですが、1 は実装レベルでは未解決で、加えて新たなブロッカーが 1 点あります。

- 重大: 現在のプレビュー方式は GitHub 側 CSP の継承を前提としておらず、`動的実行を許可する` という要件と衝突しています。[implementation-plan.md:21](/workspace/.specs/001-html-preview/implementation-plan.md#L21) [implementation-plan.md:266](/workspace/.specs/001-html-preview/implementation-plan.md#L266) [implementation-plan.md:436](/workspace/.specs/001-html-preview/implementation-plan.md#L436)
  改善案: `about:blank` / `blob:` / `data:` のようなローカルスキームを使う前提をいったん設計上のリスクとして昇格し、GitHub の CSP を継承しないプレビュー面で本当に要件を満たせるかを先に検証してください。成立しない場合は、MVP 要件を「静的レンダリング確認」までに下げるか、別アーキテクチャに切り替える必要があります。

- 重大: `window.open('about:blank', '_blank', 'noopener')` と `newTab.document.write(...)` は両立しません。`noopener` を付けると戻り値ハンドルに依存する現在の実装は成立しません。[implementation-plan.md:22](/workspace/.specs/001-html-preview/implementation-plan.md#L22) [implementation-plan.md:269](/workspace/.specs/001-html-preview/implementation-plan.md#L269)
  改善案: `noopener` を維持するなら、書き込み可能な別方式に設計変更が必要です。逆に現在の `document.write` 方式を採るなら、`noopener` 方針をどう満たすかを別途明文化してください。

- 中: レンダリング方式がまだ文書内で混在しています。Phase 1-2 の図は Blob URL 前提ですが、本文は `about:blank + document.write` 前提です。また Phase 2 の Blob URL 解放は新規タブ方式では使われず、Phase 3 の一括プレビューは説明では iframe 群なのにサンプルコードは `fetchHtmlAndOpen()` を呼んでいます。[implementation-plan.md:106](/workspace/.specs/001-html-preview/implementation-plan.md#L106) [implementation-plan.md:264](/workspace/.specs/001-html-preview/implementation-plan.md#L264) [implementation-plan.md:369](/workspace/.specs/001-html-preview/implementation-plan.md#L369) [implementation-plan.md:492](/workspace/.specs/001-html-preview/implementation-plan.md#L492)
  改善案: フェーズごとに「どの描画面を使うか」を 1 つに固定し、図、本文、テスト、DoD を同じ前提にそろえてください。

参考:
- MDN `window.open`: `noopener` 指定時は `null` を返す旨 https://developer.mozilla.org/en-US/docs/Web/API/Window/open
- CSP Level 3: `about:blank` / `blob:` / `data:` / `document.write()` 可能な文書は元文書の CSP を継承 https://w3c.github.io/webappsec-csp/
