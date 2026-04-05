OpenAI Codex v0.117.0 (research preview)
--------
workdir: /workspace
model: gpt-5.4
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 019d5d2f-d949-7b43-9507-05c7d6db979f
--------
user
以下の実装計画をレビューしてください。

【重要】ファイルの作成・編集は一切行わないでください。レビュー結果は標準出力のみで回答してください。

レビュー対象: .specs/001-html-preview/implementation-plan.md

前回のレビュー (plan-review/review-003.md) で以下の指摘があり、修正済みです:
1. Blob URL origin 問題: extension 管理の preview.html + sandbox="allow-scripts" iframe 方式に変更。content script が直接 Blob URL を開く方式は廃止
2. ポップアップブロック: クリックイベント内で同期的に chrome.runtime.getURL('preview.html') を window.open。fetch は非同期で後から実行し、background 経由で preview page に HTML を送信
3. Phase 3 の <base> 注入明文化: buildPreviewHtml() を共通処理として集約。新規タブ・inline iframe 両方で使用。Phase 3 DoD にも相対パス解決を追加

レビュー観点:
1. 前回の指摘が適切に反映されているか
2. 新たな仕様の曖昧さ・抜け漏れはないか
3. 実装可能性に問題はないか

問題がなければ「問題なし」と回答してください。
問題があれば具体的な指摘と改善案を提示してください。
warning: Codex could not find system bubblewrap at /usr/bin/bwrap. Please install bubblewrap with your package manager. Codex will use the vendored bubblewrap in the meantime.
codex
レビュー対象の計画書と前回レビュー内容を確認し、指摘が反映されているかと新たな実装リスクを見ます。まず対象ファイルと前回レビューを読みます。
exec
/bin/bash -lc "sed -n '1,260p' .specs/001-html-preview/implementation-plan.md" in /workspace
exec
/bin/bash -lc "sed -n '1,260p' plan-review/review-003.md" in /workspace
 exited 2 in 0ms:
sed: can't read plan-review/review-003.md: No such file or directory

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
- **extension preview page + sandbox iframe 方式**: content script が直接 Blob URL を開くと github.com origin になる問題を回避するため、extension 管理の `preview.html` ページ内の `sandbox="allow-scripts"` 付き iframe でレンダリングする。これにより:
  - プレビュー HTML は extension origin で隔離される
  - sandbox により github.com のクッキーや API へのアクセスが遮断される
  - script 実行は許可（`allow-scripts`）されるが、same-origin アクセスは不可
- **ユーザーが意図的にプレビューする操作フロー**のため、untrusted HTML の実行リスクはユーザー判断に委ねる

### 相対パス解決方針

- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
- **Phase 1**: `<base href>` タグを HTML の `<head>` に注入してから Blob を作成する。raw URL のディレクトリを基準 URL とする
- 注入する base URL: `https://github.com/{owner}/{repo}/raw/{sha}/{dir}/`
- これにより `./style.css` 等の相対参照が raw URL 経由で解決される

### レンダリング方式

- **共通処理**: `buildPreviewHtml(rawUrl, html)` で `<base>` タグを注入。新規タブ・インライン iframe の両方がこれを使用
- **Phase 1-2 (新規タブ)**: クリック時に `chrome.runtime.getURL('preview.html')` を同期的に `window.open`（ポップアップブロック回避）→ content script が fetch → background 経由で preview.html に HTML を送信 → preview.html 内の sandboxed iframe で描画
- **Phase 3 (インライン)**: diff 下部に `sandbox="allow-scripts"` 付き iframe を挿入し、srcdoc で描画

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

#### Phase 1-2: 新規タブプレビュー（extension preview page 経由）

```
+----------+     click      +------------------+  window.open   +----------------+
|  User    +--------------->| Content Script   +--------------->| preview.html   |
|          |                | (content.ts)     |  (sync, in     | (extension     |
+----------+                +--------+---------+  click event)  |  page)         |
                                     |                          +-------+--------+
                                     |                                  |
                              fetch  |                          waiting for msg
                            (async)  |                                  |
                                     v                                  |
                            +----------------+                          |
                            | github.com     |                          |
                            | /raw/{sha}/... |                          |
                            +-------+--------+                          |
                                    |                                   |
                             HTML text                                  |
                                    |                                   |
                                    v                                   |
                            +----------------+                          |
                            | Content Script |                          |
                            | buildPreviewHtml                          |
                            | (injectBaseTag)|                          |
                            +-------+--------+                          |
                                    |                                   |
                            chrome.runtime                              |
                            .sendMessage()                              |
                                    |                                   |
                                    v                                   |
                            +----------------+    chrome.tabs           |
                            | Background     +----.sendMessage--------->|
                            | (background.ts)|                          |
                            +----------------+                          v
                                                              +-----------------+
                                                              | <iframe         |
                                                              |  sandbox=       |
                                                              |  "allow-scripts"|
                                                              |  srcdoc=html>   |
                                                              +-----------------+
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
     |                               | buildPreviewHtml(rawUrl, html)
     |                               | （<base> タグ注入）
     |                               |
     |                               v
     |                      +--------+---------+
     |                      | <iframe>         |
     |    viewport toggle   | diff 直下に挿入   |
     +--------------------->| sandbox=         |
     |   320px / 768px /    |  "allow-scripts" |
     |   100%               | srcdoc=html      |
     |                      +--------+---------+
     |                               |
     |   "Open all HTML"             v
     +------------------------> 一括プレビュー
         PRヘッダの                  (全 .html ファイルを
         ボタンから                   順次 fetch + inline iframe)
```

---

## 3. ファイル構成

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `public/manifest.json` | `name`, `description`, `matches`（`/pull/*` に拡大）, `permissions`, `web_accessible_resources`（preview.html）の更新 |
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
| `src/content/html-fetcher.ts` | raw HTML の fetch + `<base>` 注入 + preview page 連携 |
| `src/content/html-fetcher.test.ts` | fetch フローのテスト（モック） |
| `src/preview.html` | extension preview page（sandboxed iframe でレンダリング） |
| `src/preview.ts` | preview page のスクリプト（background からの HTML 受信 + iframe 書き込み） |
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

exec
/bin/bash -lc 'git status --short' in /workspace
 succeeded in 0ms:
 M .devcontainer/devcontainer.json
 M .devcontainer/docker-compose.yml
 M .devcontainer/node/Dockerfile
 M .gitignore
 M package.json
?? .specs/
?? CLAUDE.md
?? docs/
?? pnpm-lock.yaml

codex
前回レビューのファイル位置が指定どおりでは見つからなかったので、関連ファイルを探索します。あわせて計画書の後半も読みます。
exec
/bin/bash -lc "rg --files | rg 'review-003\\.md|implementation-plan\\.md|plan-review'" in /workspace
 exited 1 in 0ms:
exec
/bin/bash -lc "sed -n '261,520p' .specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:

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

重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。

### 4.4 fetch + Blob + 新規タブ

Extension の preview page を経由する方式。ポップアップブロック回避と origin 隔離を両立:

```
クリックイベント（同期）                     非同期処理
──────────────────                     ─────────────
1. window.open(                        3. content script: fetch(rawUrl)
     chrome.runtime.getURL(            4. content script: injectBaseTag(html)
       'preview.html?id=xxx'           5. content script: chrome.runtime.sendMessage(
     ), '_blank'                             {type: 'preview-html', id: xxx, html: htmlWithBase}
   )                                       )
2. preview.html がロード開始            6. background: タブIDへメッセージ転送
                                       7. preview.html: iframe.srcdoc = html
```

```typescript
// content script 側
async function fetchAndPreview(rawUrl: string): Promise<void> {
  // 1. クリックイベント内で同期的に preview page を開く（ポップアップブロック回避）
  const previewId = crypto.randomUUID();
  const previewUrl = chrome.runtime.getURL(`preview.html?id=${previewId}`);
  window.open(previewUrl, '_blank');

  // 2. raw HTML を取得
  const response = await fetch(rawUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();

  // 3. <base> タグを注入して相対パスを解決
  const htmlWithBase = buildPreviewHtml(rawUrl, html);

  // 4. background 経由で preview page に HTML を送信
  chrome.runtime.sendMessage({
    type: 'preview-html',
    id: previewId,
    html: htmlWithBase,
  });
}

// 共通処理: <base> タグ注入（新規タブ・inline iframe 両方で使用）
function buildPreviewHtml(rawUrl: string, html: string): string {
  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
  return injectBaseTag(html, baseUrl);
}

function injectBaseTag(html: string, baseUrl: string): string {
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head><base href="${baseUrl}">`);
  }
  if (html.includes('<head ')) {
    return html.replace(/<head\s[^>]*>/, `$&<base href="${baseUrl}">`);
  }
  return `<base href="${baseUrl}">${html}`;
}
```

```typescript
// background script 側（メッセージ転送）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'preview-html') {
    // preview page のタブにメッセージを転送
    chrome.tabs.query({ url: chrome.runtime.getURL('preview.html*') }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, message);
      }
    });
  }
});
```

```html
<!-- preview.html -->
<!DOCTYPE html>
<html>
<head><title>HTML Preview</title></head>
<body style="margin:0; height:100vh;">
  <iframe id="preview" sandbox="allow-scripts" style="width:100%; height:100%; border:none;"></iframe>
  <script src="assets/preview.js"></script>
</body>
</html>
```

```typescript
// preview.ts
const params = new URLSearchParams(location.search);
const previewId = params.get('id');

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'preview-html' && message.id === previewId) {
    const iframe = document.getElementById('preview') as HTMLIFrameElement;
    iframe.srcdoc = message.html;
  }
});
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

### 5.2 メモリ管理

新規タブプレビューは extension の preview.html + srcdoc を使用するため Blob URL は不要。
Phase 3 のインライン iframe は srcdoc で直接 HTML を渡すため、こちらも Blob URL 不要。

大きな HTML のメモリ管理:
- インライン iframe を閉じたときに srcdoc をクリアしてメモリを解放
- chrome.runtime.sendMessage で送信する HTML のサイズに注意（Chrome の制限: メッセージサイズ上限は約 64MB）

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
  html: string,
  viewportWidth: string
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.srcdoc = html;  // buildPreviewHtml で <base> 注入済み
  iframe.style.cssText = `
    width: ${viewportWidth};
    height: 400px;
    border: 1px solid var(--color-border-default);
    border-radius: 6px;
    resize: vertical;
    overflow: auto;
  `;
  iframe.setAttribute('sandbox', 'allow-scripts');

exec
/bin/bash -lc "sed -n '521,780p' .specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
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
    if (!rawUrl) continue;
    // 各ファイルの diff 下部にインライン iframe を展開
    const container = getDiffContainer(header);
    if (container) await fetchAndShowInline(rawUrl, container);
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

- **ランナー**: Vitest
- **DOM 環境**: happy-dom
- **モック基盤**: `src/test/setup.ts` で Chrome API + ブラウザ API をモック
- **方針**: TDD（Red-Green-Refactor サイクル）

### 7.2 追加モック（setup.ts に追加）

```typescript
// fetch モック
vi.stubGlobal('fetch', vi.fn());

// window.open
vi.stubGlobal('open', vi.fn());

// chrome.runtime 拡張（sendMessage, getURL, onMessage）
chromeMock.runtime.sendMessage = vi.fn();
chromeMock.runtime.getURL = vi.fn((path: string) => `chrome-extension://mock-id/${path}`);
chromeMock.runtime.onMessage = {
  addListener: vi.fn(),
  removeListener: vi.fn(),
};

// crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'mock-uuid'),
});
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
- fetch 成功 -> buildPreviewHtml -> chrome.runtime.sendMessage
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
| メモリ管理 | 低 | srcdoc 方式のため Blob URL 不要。iframe 閉じ時に srcdoc クリア |
| MutationObserver 過剰発火 | 中 | debounce (150ms)。Phase 2 で対応 |
| コンテンツスクリプト IIFE 制約 | 低 | Vite がバンドル時に解決。ソースでは import 可能 |
| 相対パス（CSS/JS/画像）の解決 | 高 | `<base href>` タグを HTML に注入し、raw URL ディレクトリを基準 URL とする |
| ポップアップブロック | 低 | クリックイベント内で同期的に extension page を `window.open`。transient activation 内のため確実 |
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
- [ ] インライン iframe 閉じ時に srcdoc がクリアされる
- [ ] ダーク/ライトテーマでボタンスタイルが適切
- [ ] MutationObserver が debounce (150ms) されている
- [ ] 折り畳まれた diff でもボタンが機能する
- [ ] エラーハンドリングのテストが通る
- [ ] 10 ファイル以上の PR で動作確認

### Phase 3 (拡張)

- [ ] diff 下部にインライン iframe でプレビュー表示可能（`sandbox="allow-scripts"` + srcdoc）
- [ ] インライン iframe でも相対 CSS/JS/画像が `<base>` タグにより正しく解決される
- [ ] iframe のリサイズ（ドラッグ）が可能
- [ ] Desktop/Tablet/Mobile の viewport 切替が動作する
- [ ] PR ヘッダに「Preview All HTML」ボタンが表示される
- [ ] `/blob/` ページでも Preview ボタンが表示される
- [ ] 各拡張機能のテストが通る

codex
計画書の記述だけでは実装可能性の判断が甘くなるので、現状の構成も最小限確認します。拡張のビルド前提とファイル配置の整合を見ます。
exec
/bin/bash -lc "rg --files src public . 2>/dev/null | sed -n '1,240p'" in /workspace
 succeeded in 0ms:
public/manifest.json
./README.md
./tsconfig.json
./package.json
src/content.ts
src/background.ts
src/index.css
./tsconfig.test.json
./postcss.config.js
./vitest.config.ts
./vite.config.ts
./src/content.ts
./src/background.ts
./src/index.css
./LICENSE
./tailwind.config.js
./tsconfig.node.json
./pnpm-lock.yaml
./tsconfig.base.json
./tsconfig.app.json
./vite.content.config.ts
./docs/plan.md
./CLAUDE.md
./public/manifest.json
src/test/setup.ts
./src/options/index.html
./src/options/index.tsx
./src/options/App.tsx
./src/test/setup.ts
src/options/App.tsx
src/options/index.tsx
src/options/index.html

exec
/bin/bash -lc "sed -n '1,240p' package.json" in /workspace
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

exec
/bin/bash -lc "find .specs -maxdepth 3 -type f | sed -n '1,240p'" in /workspace
 succeeded in 0ms:
.specs/.guard/54795975-1484-45e6-8c61-5c12a4c452d6
.specs/001-html-preview/hearing-notes.md
.specs/001-html-preview/PLANNING
.specs/001-html-preview/exploration-report.md
.specs/001-html-preview/tasks.md
.specs/001-html-preview/implementation-plan.md
.specs/001-html-preview/plan-review/review-004.md
.specs/001-html-preview/plan-review/prompt-001.txt
.specs/001-html-preview/plan-review/prompt-002.txt
.specs/001-html-preview/plan-review/prompt-003.txt
.specs/001-html-preview/plan-review/review-001.md
.specs/001-html-preview/plan-review/prompt-004.txt
.specs/001-html-preview/plan-review/review-002.md
.specs/001-html-preview/plan-review/review-003.md

exec
/bin/bash -lc "sed -n '1,240p' .specs/001-html-preview/plan-review/review-003.md" in /workspace
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
session id: 019d5d29-0f37-7a83-b44c-aced7cb69f44
--------
user
以下の実装計画をレビューしてください。

【重要】ファイルの作成・編集は一切行わないでください。レビュー結果は標準出力のみで回答してください。

レビュー対象: .specs/001-html-preview/implementation-plan.md

前回のレビュー (plan-review/review-002.md) で以下の指摘があり、修正済みです:
1. CSP 継承問題: about:blank + document.write を廃止し、Blob URL 方式に統一。Blob URL は opaque origin で GitHub CSP を継承しない
2. noopener + document.write 矛盾: document.write を廃止。Blob URL の window.open を使用。noopener も不要（opaque origin）
3. レンダリング方式の混在: Phase 1-2 は Blob URL + window.open、Phase 3 は Blob URL + iframe に統一。図・本文・テスト・DoD を一致させた

レビュー観点:
1. 前回の指摘が適切に反映されているか
2. 新たな仕様の曖昧さ・抜け漏れはないか
3. 実装可能性に問題はないか

問題がなければ「問題なし」と回答してください。
問題があれば具体的な指摘と改善案を提示してください。
warning: Codex could not find system bubblewrap at /usr/bin/bwrap. Please install bubblewrap with your package manager. Codex will use the vendored bubblewrap in the meantime.
codex
レビュー対象の計画書を読み、前回指摘の反映状況と新たな曖昧さを確認します。必要なら前回レビュー内容も参照して整合性を見ます。
exec
/bin/bash -lc "pwd && rg --files .specs plan-review | sed 's#"'^#/#'"'" in /workspace
 succeeded in 0ms:
/workspace
rg: plan-review: No such file or directory (os error 2)
/.specs/001-html-preview/plan-review/review-003.md
/.specs/001-html-preview/plan-review/review-002.md
/.specs/001-html-preview/plan-review/review-001.md
/.specs/001-html-preview/plan-review/prompt-003.txt
/.specs/001-html-preview/plan-review/prompt-002.txt
/.specs/001-html-preview/plan-review/prompt-001.txt
/.specs/001-html-preview/implementation-plan.md
/.specs/001-html-preview/tasks.md
/.specs/001-html-preview/exploration-report.md
/.specs/001-html-preview/PLANNING
/.specs/001-html-preview/hearing-notes.md

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
- **Blob URL 方式を採用**: Blob URL は opaque origin を持ち、GitHub の CSP を継承しない（plan.md で検証済み）。opener からも github.com のコンテキストにアクセスできない
- **Phase 3 の iframe は `sandbox="allow-scripts"`**: `allow-same-origin` は付与しない（Blob URL のため不要）
- **ユーザーが意図的にプレビューする操作フロー**のため、untrusted HTML の実行リスクはユーザー判断に委ねる

### 相対パス解決方針

- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
- **Phase 1**: `<base href>` タグを HTML の `<head>` に注入してから Blob を作成する。raw URL のディレクトリを基準 URL とする
- 注入する base URL: `https://github.com/{owner}/{repo}/raw/{sha}/{dir}/`
- これにより `./style.css` 等の相対参照が raw URL 経由で解決される

### レンダリング方式

- **Phase 1-2 (新規タブ)**: HTML に `<base>` 注入 → Blob 作成 → `URL.createObjectURL` → `window.open(blobUrl, '_blank')`
- **Phase 3 (インライン)**: 同じ Blob URL を `<iframe src=blobUrl sandbox="allow-scripts">` で使用
- **一貫して Blob URL 方式**を使用。`about:blank` + `document.write` は使わない（CSP 継承問題を回避）

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
                                     | injectBaseTag(html, baseUrl)
                                     | new Blob([htmlWithBase], {type: 'text/html'})
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

codex
主要な論点はメッセージ連携と HTML 注入処理の堅牢性です。manifest と既存エントリの前提も確認して、計画上の抜けが本当に実装障害になるかを見ます。
exec
/bin/bash -lc "sed -n '1,240p' public/manifest.json" in /workspace
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
/bin/bash -lc "sed -n '1,240p' src/background.ts" in /workspace
 succeeded in 0ms:
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

exec
/bin/bash -lc "sed -n '1,240p' src/content.ts" in /workspace
 succeeded in 0ms:
// Content script
// This script runs in the context of web pages

console.log('Content script loaded');

exec
/bin/bash -lc "sed -n '1,240p' vite.config.ts" in /workspace
 succeeded in 0ms:
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

exec
/bin/bash -lc "sed -n '1,240p' vite.content.config.ts" in /workspace
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
不整合箇所の位置を正確に示すため、関連行だけ行番号付きで確認します。
exec
/bin/bash -lc "nl -ba .specs/001-html-preview/implementation-plan.md | sed -n '1,220p'" in /workspace
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
    22	- **extension preview page + sandbox iframe 方式**: content script が直接 Blob URL を開くと github.com origin になる問題を回避するため、extension 管理の `preview.html` ページ内の `sandbox="allow-scripts"` 付き iframe でレンダリングする。これにより:
    23	  - プレビュー HTML は extension origin で隔離される
    24	  - sandbox により github.com のクッキーや API へのアクセスが遮断される
    25	  - script 実行は許可（`allow-scripts`）されるが、same-origin アクセスは不可
    26	- **ユーザーが意図的にプレビューする操作フロー**のため、untrusted HTML の実行リスクはユーザー判断に委ねる
    27	
    28	### 相対パス解決方針
    29	
    30	- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
    31	- **Phase 1**: `<base href>` タグを HTML の `<head>` に注入してから Blob を作成する。raw URL のディレクトリを基準 URL とする
    32	- 注入する base URL: `https://github.com/{owner}/{repo}/raw/{sha}/{dir}/`
    33	- これにより `./style.css` 等の相対参照が raw URL 経由で解決される
    34	
    35	### レンダリング方式
    36	
    37	- **共通処理**: `buildPreviewHtml(rawUrl, html)` で `<base>` タグを注入。新規タブ・インライン iframe の両方がこれを使用
    38	- **Phase 1-2 (新規タブ)**: クリック時に `chrome.runtime.getURL('preview.html')` を同期的に `window.open`（ポップアップブロック回避）→ content script が fetch → background 経由で preview.html に HTML を送信 → preview.html 内の sandboxed iframe で描画
    39	- **Phase 3 (インライン)**: diff 下部に `sandbox="allow-scripts"` 付き iframe を挿入し、srcdoc で描画
    40	
    41	---
    42	
    43	## 2. システム図
    44	
    45	### 2.1 状態マシン図（コンテンツスクリプトのライフサイクル）
    46	
    47	```
    48	                          +-----------+
    49	                          |   IDLE    |
    50	                          | (初期状態) |
    51	                          +-----+-----+
    52	                                |
    53	                          page load / document_end
    54	                                |
    55	                                v
    56	                    +---------------------+
    57	                    |   OBSERVING         |
    58	                    | MutationObserver    |
    59	                    | 起動 + 初回スキャン   |
    60	                    +-----+--------+------+
    61	                          |        ^
    62	                 DOM変更検出 |        | debounce 後に再監視
    63	                          v        |
    64	                  +----------------+------+
    65	                  |  SCANNING             |
    66	                  |  ファイルヘッダ検出     |
    67	                  |  (.html判定)           |
    68	                  +---+------+------+-----+
    69	                      |      |      |
    70	            HTML なし  |      |      | エラー（DOM構造変更）
    71	            +---------+      |      +----------+
    72	            |                |                 |
    73	            v                v                 v
    74	     (OBSERVING       +------------+    +-----------+
    75	      に戻る)         | INSERTING  |    |   ERROR   |
    76	                      | ボタン挿入  |    | ログ出力   |
    77	                      +-----+------+    +-----+-----+
    78	                            |                 |
    79	                            v                 v
    80	                      +------------+    (OBSERVING
    81	                      |  WAITING   |     に戻る)
    82	                      | クリック待ち |
    83	                      +-----+------+
    84	                            |
    85	                      ユーザーがクリック
    86	                            |
    87	                            v
    88	                      +------------+
    89	                      |  FETCHING  |
    90	                      | raw HTML   |
    91	                      | fetch 実行  |
    92	                      +-----+------+
    93	                            |
    94	                +-----------+-----------+
    95	                |                       |
    96	          成功 (200)              失敗 / タイムアウト
    97	                |                       |
    98	                v                       v
    99	         +-------------+        +--------------+
   100	         |  PREVIEWING |        | FETCH_ERROR  |
   101	         | Blob生成     |        | ボタンに      |
   102	         | 新規タブ表示  |        | エラー表示    |
   103	         +------+------+        +------+-------+
   104	                |                       |
   105	                v                       v
   106	          (WAITING                (WAITING
   107	           に戻る)                 に戻る)
   108	```
   109	
   110	### 2.2 データフロー図
   111	
   112	#### Phase 1-2: 新規タブプレビュー（extension preview page 経由）
   113	
   114	```
   115	+----------+     click      +------------------+  window.open   +----------------+
   116	|  User    +--------------->| Content Script   +--------------->| preview.html   |
   117	|          |                | (content.ts)     |  (sync, in     | (extension     |
   118	+----------+                +--------+---------+  click event)  |  page)         |
   119	                                     |                          +-------+--------+
   120	                                     |                                  |
   121	                              fetch  |                          waiting for msg
   122	                            (async)  |                                  |
   123	                                     v                                  |
   124	                            +----------------+                          |
   125	                            | github.com     |                          |
   126	                            | /raw/{sha}/... |                          |
   127	                            +-------+--------+                          |
   128	                                    |                                   |
   129	                             HTML text                                  |
   130	                                    |                                   |
   131	                                    v                                   |
   132	                            +----------------+                          |
   133	                            | Content Script |                          |
   134	                            | buildPreviewHtml                          |
   135	                            | (injectBaseTag)|                          |
   136	                            +-------+--------+                          |
   137	                                    |                                   |
   138	                            chrome.runtime                              |
   139	                            .sendMessage()                              |
   140	                                    |                                   |
   141	                                    v                                   |
   142	                            +----------------+    chrome.tabs           |
   143	                            | Background     +----.sendMessage--------->|
   144	                            | (background.ts)|                          |
   145	                            +----------------+                          v
   146	                                                              +-----------------+
   147	                                                              | <iframe         |
   148	                                                              |  sandbox=       |
   149	                                                              |  "allow-scripts"|
   150	                                                              |  srcdoc=html>   |
   151	                                                              +-----------------+
   152	```
   153	
   154	#### Phase 3: インライン iframe プレビュー
   155	
   156	```
   157	+----------+     click      +------------------+     fetch      +----------------+
   158	|  User    +--------------->| Content Script   +--------------->| github.com     |
   159	|          |                | (content.ts)     |                | /raw/...       |
   160	+----+-----+                +--------+---------+                +-------+--------+
   161	     |                               |                                  |
   162	     |                               |<---------------------------------+
   163	     |                               |  response (HTML text)
   164	     |                               |
   165	     |                               | buildPreviewHtml(rawUrl, html)
   166	     |                               | （<base> タグ注入）
   167	     |                               |
   168	     |                               v
   169	     |                      +--------+---------+
   170	     |                      | <iframe>         |
   171	     |    viewport toggle   | diff 直下に挿入   |
   172	     +--------------------->| sandbox=         |
   173	     |   320px / 768px /    |  "allow-scripts" |
   174	     |   100%               | srcdoc=html      |
   175	     |                      +--------+---------+
   176	     |                               |
   177	     |   "Open all HTML"             v
   178	     +------------------------> 一括プレビュー
   179	         PRヘッダの                  (全 .html ファイルを
   180	         ボタンから                   順次 fetch + inline iframe)
   181	```
   182	
   183	---
   184	
   185	## 3. ファイル構成
   186	
   187	### 変更ファイル
   188	
   189	| ファイル | 変更内容 |
   190	|---------|---------|
   191	| `public/manifest.json` | `name`, `description`, `matches`（`/pull/*` に拡大）, `permissions`, `web_accessible_resources`（preview.html）の更新 |
   192	| `src/content.ts` | エントリポイントとして各モジュールを統合 |
   193	| `src/background.ts` | 必要に応じて設定管理を追加 |
   194	| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |
   195	
   196	### 新規ファイル
   197	
   198	| ファイル | 責務 |
   199	|---------|------|
   200	| `src/content/types.ts` | 共通型定義（ButtonState, FileHeaderInfo 等） |
   201	| `src/content/url-utils.ts` | URL 変換（blob -> raw）、`<base>` タグ注入。純粋関数 |
   202	| `src/content/url-utils.test.ts` | URL 変換のユニットテスト |
   203	| `src/content/github-dom.ts` | GitHub DOM セレクタ、ファイルヘッダ検出、HTML ファイル判定 |
   204	| `src/content/github-dom.test.ts` | DOM 検出のテスト（happy-dom） |
   205	| `src/content/preview-button.ts` | Preview ボタンの生成・挿入・重複防止・状態管理 |
   206	| `src/content/preview-button.test.ts` | ボタン挿入のテスト |
   207	| `src/content/html-fetcher.ts` | raw HTML の fetch + `<base>` 注入 + preview page 連携 |
   208	| `src/content/html-fetcher.test.ts` | fetch フローのテスト（モック） |
   209	| `src/preview.html` | extension preview page（sandboxed iframe でレンダリング） |
   210	| `src/preview.ts` | preview page のスクリプト（background からの HTML 受信 + iframe 書き込み） |
   211	| `src/content/observer.ts` | MutationObserver + debounce |
   212	| `src/content/observer.test.ts` | Observer のテスト |
   213	| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
   214	| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
   215	| `src/content/viewport-toggle.ts` | Phase 3: viewport 切替 UI |
   216	| `src/content/viewport-toggle.test.ts` | Phase 3: viewport 切替のテスト |
   217	| `src/content/batch-preview.ts` | Phase 3: 一括プレビュー |
   218	| `src/content/batch-preview.test.ts` | Phase 3: 一括プレビューのテスト |
   219	
   220	---

exec
/bin/bash -lc "nl -ba .specs/001-html-preview/implementation-plan.md | sed -n '220,520p'" in /workspace
 succeeded in 0ms:
   220	---
   221	
   222	## 4. Phase 1 (MVP) 実装詳細
   223	
   224	### 4.1 DOM セレクタ戦略
   225	
   226	GitHub PR の Files changed タブのファイルヘッダ検出は、複数セレクタでフォールバックする:
   227	
   228	```typescript
   229	const FILE_HEADER_SELECTORS = [
   230	  '[data-tagsearch-path]',           // data属性ベース（最安定）
   231	  '.file-header[data-path]',         // クラス + data属性
   232	  '.file-header',                    // クラスのみ（フォールバック）
   233	] as const;
   234	```
   235	
   236	パス取得も複数戦略でフォールバック:
   237	
   238	```typescript
   239	const FILE_PATH_EXTRACTORS = [
   240	  (el: Element) => el.getAttribute('data-tagsearch-path'),
   241	  (el: Element) => el.getAttribute('data-path'),
   242	  (el: Element) => el.querySelector('[title]')?.getAttribute('title'),
   243	] as const;
   244	```
   245	
   246	検出優先順位: `data-*` 属性 > クラス名。`div[id^="diff-"]` は広すぎるため除外。
   247	
   248	**ページタイプ判定**: `matches` を `/pull/*` に広げるため、content script 内で URL パスから Files changed タブかどうかを runtime 判定する:
   249	
   250	```typescript
   251	function isFilesChangedTab(): boolean {
   252	  return /\/pull\/\d+\/files/.test(location.pathname);
   253	}
   254	```
   255	
   256	GitHub の PJAX/Turbo 遷移に対応するため、`popstate` イベントや `turbo:load` イベントも監視する。
   257	
   258	### 4.2 URL 変換
   259	
   260	**URL ソース**: "View file" リンク (`a[href*="/blob/"]`) の absolute href を唯一のソースとする。ファイルヘッダからの独自構築は行わない（fork PR やブランチ名に `/` を含むケースで壊れるため）。
   261	
   262	```
   263	入力: https://github.com/owner/repo/blob/{sha}/{path}
   264	出力: https://github.com/owner/repo/raw/{sha}/{path}
   265	
   266	変換: "/blob/" -> "/raw/" の単純置換
   267	```
   268	
   269	"View file" リンクが見つからないファイル（削除ファイル、rename の旧名側）は非対応とし、ボタンを挿入しない。
   270	
   271	特殊文字の扱い: ブラウザが href を自動エンコード済みのため、追加の `encodeURI` は不要。`#` や `?` を含むファイル名は href のパース時に壊れる可能性があるが、GitHub がそれらを適切にエンコードした href を生成するため問題なし。
   272	
   273	### 4.3 ボタン挿入
   274	
   275	```typescript
   276	// ボタンの識別用カスタム属性（重複防止）
   277	const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';
   278	
   279	// GitHub のボタンスタイルに合わせる
   280	const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
   281	```
   282	
   283	挿入位置: ファイルヘッダ内の `.file-actions` または `.file-info`、末尾にフォールバック。既存のアクションボタン群の隣に配置。
   284	
   285	重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。
   286	
   287	### 4.4 fetch + Blob + 新規タブ
   288	
   289	Extension の preview page を経由する方式。ポップアップブロック回避と origin 隔離を両立:
   290	
   291	```
   292	クリックイベント（同期）                     非同期処理
   293	──────────────────                     ─────────────
   294	1. window.open(                        3. content script: fetch(rawUrl)
   295	     chrome.runtime.getURL(            4. content script: injectBaseTag(html)
   296	       'preview.html?id=xxx'           5. content script: chrome.runtime.sendMessage(
   297	     ), '_blank'                             {type: 'preview-html', id: xxx, html: htmlWithBase}
   298	   )                                       )
   299	2. preview.html がロード開始            6. background: タブIDへメッセージ転送
   300	                                       7. preview.html: iframe.srcdoc = html
   301	```
   302	
   303	```typescript
   304	// content script 側
   305	async function fetchAndPreview(rawUrl: string): Promise<void> {
   306	  // 1. クリックイベント内で同期的に preview page を開く（ポップアップブロック回避）
   307	  const previewId = crypto.randomUUID();
   308	  const previewUrl = chrome.runtime.getURL(`preview.html?id=${previewId}`);
   309	  window.open(previewUrl, '_blank');
   310	
   311	  // 2. raw HTML を取得
   312	  const response = await fetch(rawUrl, { credentials: 'include' });
   313	  if (!response.ok) throw new Error(`HTTP ${response.status}`);
   314	  const html = await response.text();
   315	
   316	  // 3. <base> タグを注入して相対パスを解決
   317	  const htmlWithBase = buildPreviewHtml(rawUrl, html);
   318	
   319	  // 4. background 経由で preview page に HTML を送信
   320	  chrome.runtime.sendMessage({
   321	    type: 'preview-html',
   322	    id: previewId,
   323	    html: htmlWithBase,
   324	  });
   325	}
   326	
   327	// 共通処理: <base> タグ注入（新規タブ・inline iframe 両方で使用）
   328	function buildPreviewHtml(rawUrl: string, html: string): string {
   329	  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
   330	  return injectBaseTag(html, baseUrl);
   331	}
   332	
   333	function injectBaseTag(html: string, baseUrl: string): string {
   334	  if (html.includes('<head>')) {
   335	    return html.replace('<head>', `<head><base href="${baseUrl}">`);
   336	  }
   337	  if (html.includes('<head ')) {
   338	    return html.replace(/<head\s[^>]*>/, `$&<base href="${baseUrl}">`);
   339	  }
   340	  return `<base href="${baseUrl}">${html}`;
   341	}
   342	```
   343	
   344	```typescript
   345	// background script 側（メッセージ転送）
   346	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
   347	  if (message.type === 'preview-html') {
   348	    // preview page のタブにメッセージを転送
   349	    chrome.tabs.query({ url: chrome.runtime.getURL('preview.html*') }, (tabs) => {
   350	      for (const tab of tabs) {
   351	        if (tab.id) chrome.tabs.sendMessage(tab.id, message);
   352	      }
   353	    });
   354	  }
   355	});
   356	```
   357	
   358	```html
   359	<!-- preview.html -->
   360	<!DOCTYPE html>
   361	<html>
   362	<head><title>HTML Preview</title></head>
   363	<body style="margin:0; height:100vh;">
   364	  <iframe id="preview" sandbox="allow-scripts" style="width:100%; height:100%; border:none;"></iframe>
   365	  <script src="assets/preview.js"></script>
   366	</body>
   367	</html>
   368	```
   369	
   370	```typescript
   371	// preview.ts
   372	const params = new URLSearchParams(location.search);
   373	const previewId = params.get('id');
   374	
   375	chrome.runtime.onMessage.addListener((message) => {
   376	  if (message.type === 'preview-html' && message.id === previewId) {
   377	    const iframe = document.getElementById('preview') as HTMLIFrameElement;
   378	    iframe.srcdoc = message.html;
   379	  }
   380	});
   381	```
   382	
   383	### 4.5 MutationObserver
   384	
   385	GitHub PR は diff を遅延読み込みするため、DOM 変更を監視してボタンを挿入する。また、GitHub の PJAX/Turbo 遷移にも対応:
   386	
   387	```typescript
   388	const observer = new MutationObserver(() => {
   389	  if (isFilesChangedTab()) {
   390	    addPreviewButtons();
   391	  }
   392	});
   393	
   394	observer.observe(document.body, {
   395	  childList: true,
   396	  subtree: true,
   397	});
   398	
   399	// PJAX/Turbo 遷移対応
   400	document.addEventListener('turbo:load', () => {
   401	  if (isFilesChangedTab()) addPreviewButtons();
   402	});
   403	window.addEventListener('popstate', () => {
   404	  if (isFilesChangedTab()) addPreviewButtons();
   405	});
   406	
   407	// 初回スキャン
   408	if (isFilesChangedTab()) addPreviewButtons();
   409	```
   410	
   411	---
   412	
   413	## 5. Phase 2 (堅牢化) 実装詳細
   414	
   415	### 5.1 エラーハンドリング
   416	
   417	fetch 失敗時のユーザーフィードバック:
   418	
   419	```
   420	+------------------+     +-------------------+     +------------------+
   421	| fetch 実行       | --> | レスポンス判定     | --> | 成功: プレビュー  |
   422	+------------------+     +---+---------------+     +------------------+
   423	                             |
   424	                             | 失敗
   425	                             v
   426	                   +---------+----------+
   427	                   | エラー種別判定      |
   428	                   +--+------+------+---+
   429	                      |      |      |
   430	                      v      v      v
   431	                  network  401/   その他
   432	                  error    403
   433	                      |      |      |
   434	                      v      v      v
   435	                  "Network "Session "Preview
   436	                   error"  expired" failed"
   437	```
   438	
   439	ボタンの状態管理:
   440	
   441	```typescript
   442	type ButtonState = 'idle' | 'loading' | 'error';
   443	```
   444	
   445	ボタンのテキストを一時的にエラーメッセージに変更し、3秒後に復帰する。
   446	
   447	セッション切れ検知: レスポンスの URL がログインページにリダイレクトされた場合を判定。
   448	
   449	### 5.2 メモリ管理
   450	
   451	新規タブプレビューは extension の preview.html + srcdoc を使用するため Blob URL は不要。
   452	Phase 3 のインライン iframe は srcdoc で直接 HTML を渡すため、こちらも Blob URL 不要。
   453	
   454	大きな HTML のメモリ管理:
   455	- インライン iframe を閉じたときに srcdoc をクリアしてメモリを解放
   456	- chrome.runtime.sendMessage で送信する HTML のサイズに注意（Chrome の制限: メッセージサイズ上限は約 64MB）
   457	
   458	### 5.3 テーマ対応
   459	
   460	GitHub の `data-color-mode` 属性と既存 CSS 変数を活用:
   461	
   462	```typescript
   463	function getTheme(): 'light' | 'dark' {
   464	  return document.documentElement.getAttribute('data-color-mode') === 'dark'
   465	    ? 'dark' : 'light';
   466	}
   467	```
   468	
   469	GitHub ネイティブの `btn` クラスを使うことで基本的に自動追従する。カスタムスタイルが必要な場合のみ `--color-btn-bg`, `--color-btn-text` 等の CSS 変数を参照。
   470	
   471	### 5.4 debounce
   472	
   473	MutationObserver の過剰発火を抑制:
   474	
   475	```typescript
   476	function debounce<T extends (...args: unknown[]) => void>(
   477	  fn: T,
   478	  delay: number
   479	): T {
   480	  let timer: ReturnType<typeof setTimeout> | null = null;
   481	  return ((...args: unknown[]) => {
   482	    if (timer) clearTimeout(timer);
   483	    timer = setTimeout(() => fn(...args), delay);
   484	  }) as T;
   485	}
   486	
   487	// 使用: 150ms debounce
   488	const debouncedAddButtons = debounce(addPreviewButtons, 150);
   489	const observer = new MutationObserver(debouncedAddButtons);
   490	```
   491	
   492	### 5.5 折り畳み対応
   493	
   494	diff が collapsed 状態のファイルにもボタンを挿入。ファイルヘッダは折り畳み時も表示されるため、通常のセレクタで対応可能。
   495	
   496	---
   497	
   498	## 6. Phase 3 (拡張) 実装詳細
   499	
   500	### 6.1 インライン iframe プレビュー
   501	
   502	diff ブロックの直下に iframe を挿入:
   503	
   504	```typescript
   505	function createInlinePreview(
   506	  container: Element,
   507	  html: string,
   508	  viewportWidth: string
   509	): HTMLIFrameElement {
   510	  const iframe = document.createElement('iframe');
   511	  iframe.srcdoc = html;  // buildPreviewHtml で <base> 注入済み
   512	  iframe.style.cssText = `
   513	    width: ${viewportWidth};
   514	    height: 400px;
   515	    border: 1px solid var(--color-border-default);
   516	    border-radius: 6px;
   517	    resize: vertical;
   518	    overflow: auto;
   519	  `;
   520	  iframe.setAttribute('sandbox', 'allow-scripts');

exec
/bin/bash -lc "nl -ba .specs/001-html-preview/implementation-plan.md | sed -n '520,760p'" in /workspace
 succeeded in 0ms:
   520	  iframe.setAttribute('sandbox', 'allow-scripts');
   521	  container.appendChild(iframe);
   522	  return iframe;
   523	}
   524	```
   525	
   526	トグル動作: 「Inline Preview」ボタンをクリックで展開/折り畳み。
   527	
   528	### 6.2 viewport 切替
   529	
   530	```
   531	+------------------------------------------+
   532	| [Mobile 375px] [Tablet 768px] [Desktop]  |  <-- 切替 UI
   533	+------------------------------------------+
   534	| +--------------------------------------+ |
   535	| |          iframe preview              | |
   536	| |      (width 動的変更)                 | |
   537	| +--------------------------------------+ |
   538	+------------------------------------------+
   539	```
   540	
   541	プリセット:
   542	
   543	```typescript
   544	const VIEWPORTS = {
   545	  mobile:  { width: '375px',  label: 'Mobile' },
   546	  tablet:  { width: '768px',  label: 'Tablet' },
   547	  desktop: { width: '100%',   label: 'Desktop' },
   548	} as const;
   549	```
   550	
   551	### 6.3 一括プレビュー
   552	
   553	PR ヘッダ付近に「Preview all HTML files」ボタンを追加:
   554	
   555	```typescript
   556	async function previewAllHtml(): Promise<void> {
   557	  const htmlHeaders = findAllHtmlFileHeaders();
   558	  for (const header of htmlHeaders) {
   559	    const rawUrl = getRawUrlFromHeader(header);
   560	    if (!rawUrl) continue;
   561	    // 各ファイルの diff 下部にインライン iframe を展開
   562	    const container = getDiffContainer(header);
   563	    if (container) await fetchAndShowInline(rawUrl, container);
   564	  }
   565	}
   566	```
   567	
   568	### 6.4 blob/ ページ対応
   569	
   570	manifest.json の matches を拡張:
   571	
   572	```json
   573	{
   574	  "matches": [
   575	    "https://github.com/*/pull/*",
   576	    "https://github.com/*/blob/*/*.html"
   577	  ]
   578	}
   579	```
   580	
   581	`/blob/` ページでは既存の "Raw" ボタンの隣に "Preview" を追加。ページタイプに応じたセレクタを使い分け。
   582	
   583	---
   584	
   585	## 7. テスト戦略
   586	
   587	### 7.1 テスト環境
   588	
   589	- **ランナー**: Vitest
   590	- **DOM 環境**: happy-dom
   591	- **モック基盤**: `src/test/setup.ts` で Chrome API + ブラウザ API をモック
   592	- **方針**: TDD（Red-Green-Refactor サイクル）
   593	
   594	### 7.2 追加モック（setup.ts に追加）
   595	
   596	```typescript
   597	// fetch モック
   598	vi.stubGlobal('fetch', vi.fn());
   599	
   600	// window.open
   601	vi.stubGlobal('open', vi.fn());
   602	
   603	// chrome.runtime 拡張（sendMessage, getURL, onMessage）
   604	chromeMock.runtime.sendMessage = vi.fn();
   605	chromeMock.runtime.getURL = vi.fn((path: string) => `chrome-extension://mock-id/${path}`);
   606	chromeMock.runtime.onMessage = {
   607	  addListener: vi.fn(),
   608	  removeListener: vi.fn(),
   609	};
   610	
   611	// crypto.randomUUID
   612	vi.stubGlobal('crypto', {
   613	  randomUUID: vi.fn(() => 'mock-uuid'),
   614	});
   615	```
   616	
   617	### 7.3 機能タイプ分類とテストパターン
   618	
   619	| 機能タイプ | テスト方法 | 対象モジュール |
   620	|-----------|-----------|--------------|
   621	| 純粋関数 | 入力 -> 出力の検証。DOM 不要 | url-utils, debounce |
   622	| DOM 検出 | happy-dom で GitHub 風 DOM を構築 -> 関数実行 -> 結果検証 | github-dom |
   623	| DOM 操作 | happy-dom で DOM 構築 -> 操作実行 -> DOM 状態検証 | preview-button, iframe-preview, viewport-toggle |
   624	| 非同期 I/O | fetch モック -> 関数実行 -> モック呼び出し検証 | html-fetcher |
   625	| Observer | happy-dom の DOM 変更トリガー -> コールバック検証 | observer |
   626	| 統合 | 上記を組み合わせたフロー検証 | content.ts |
   627	
   628	### 7.4 テスト順序（TDD サイクル）
   629	
   630	```
   631	Phase 1:
   632	  1. url-utils.test.ts        <-- 純粋関数（最もテストしやすい）
   633	  2. github-dom.test.ts       <-- DOM 検出（happy-dom）
   634	  3. preview-button.test.ts   <-- DOM 操作
   635	  4. html-fetcher.test.ts     <-- fetch モック
   636	  5. observer.test.ts         <-- MutationObserver
   637	
   638	Phase 2:
   639	  6. エラーハンドリングのテスト追加（html-fetcher.test.ts 拡張）
   640	  7. Blob URL 解放のテスト追加（html-fetcher.test.ts 拡張）
   641	  8. debounce ユーティリティのテスト（observer.test.ts 拡張）
   642	  9. テーマ検出のテスト（github-dom.test.ts 拡張）
   643	
   644	Phase 3:
   645	  10. iframe-preview.test.ts
   646	  11. viewport-toggle.test.ts
   647	  12. batch-preview.test.ts
   648	```
   649	
   650	### 7.5 テストパターン詳細
   651	
   652	**純粋関数テスト（url-utils）**:
   653	- 正常系: `/blob/` -> `/raw/` 変換
   654	- 日本語パス、スペース、特殊文字
   655	- 不正な URL（/blob/ を含まない）
   656	
   657	**DOM 検出テスト（github-dom）**:
   658	- 各セレクタパターンでのファイルヘッダ検出
   659	- .html ファイルのフィルタリング
   660	- セレクタフォールバック
   661	
   662	**DOM 操作テスト（preview-button）**:
   663	- ボタン生成の属性・クラス検証
   664	- 挿入位置の検証
   665	- 重複防止
   666	
   667	**非同期 I/O テスト（html-fetcher）**:
   668	- fetch 成功 -> buildPreviewHtml -> chrome.runtime.sendMessage
   669	- fetch 失敗（ネットワークエラー、401、403、500）
   670	- セッション切れ（リダイレクト先がログインページ）
   671	
   672	---
   673	
   674	## 8. 技術的制約とリスク対策
   675	
   676	| リスク | 影響度 | 対策 |
   677	|-------|--------|------|
   678	| GitHub DOM 構造変更 | 高 | 複数セレクタでフォールバック。`data-*` 属性優先 |
   679	| セッション切れ | 中 | fetch レスポンスのステータスコード + URL 判定。ユーザー通知 |
   680	| 大きな HTML ファイル | 低 | Blob 化は数百 KB でも問題なし。ローディング表示で UX 担保 |
   681	| CSP 制約 | 低 | Blob URL は CSP 制約を受けにくい（検証済み） |
   682	| 日本語/特殊文字パス | 中 | GitHub が href をエンコード済み。追加エンコード不要。テストケースに含める |
   683	| メモリ管理 | 低 | srcdoc 方式のため Blob URL 不要。iframe 閉じ時に srcdoc クリア |
   684	| MutationObserver 過剰発火 | 中 | debounce (150ms)。Phase 2 で対応 |
   685	| コンテンツスクリプト IIFE 制約 | 低 | Vite がバンドル時に解決。ソースでは import 可能 |
   686	| 相対パス（CSS/JS/画像）の解決 | 高 | `<base href>` タグを HTML に注入し、raw URL ディレクトリを基準 URL とする |
   687	| ポップアップブロック | 低 | クリックイベント内で同期的に extension page を `window.open`。transient activation 内のため確実 |
   688	| PJAX/Turbo 遷移 | 高 | `matches` を `/pull/*` に広げ、runtime で Files changed タブを判定。`turbo:load` + `popstate` イベント監視 |
   689	| 外部 CDN 依存の JS | 低 | 通常通り CORS/CSP に従う。個別対応 |
   690	
   691	---
   692	
   693	## 9. Definition of Done
   694	
   695	### Phase 1 (MVP)
   696	
   697	- [ ] `public/manifest.json` の matches が `https://github.com/*/pull/*` に設定されている
   698	- [ ] Files changed タブの runtime 判定が動作する（PJAX/Turbo 遷移対応）
   699	- [ ] `.html` ファイルのヘッダに「Preview」ボタンが表示される
   700	- [ ] ボタンクリックで新規タブに HTML がレンダリングされる（ポップアップブロック回避済み）
   701	- [ ] 相対パス（CSS/JS/画像）が `<base>` タグ注入により正しく解決される
   702	- [ ] 遅延読み込みされた diff にもボタンが挿入される（MutationObserver）
   703	- [ ] 重複ボタンが挿入されない
   704	- [ ] url-utils, github-dom, preview-button, html-fetcher, observer の全ユニットテストが Green
   705	- [ ] `pnpm build` が成功する
   706	- [ ] 3 ファイル以上の HTML を含む PR で動作確認
   707	
   708	### Phase 2 (堅牢化)
   709	
   710	- [ ] fetch 失敗時にボタン上にエラーメッセージが表示される
   711	- [ ] セッション切れが検知・通知される
   712	- [ ] インライン iframe 閉じ時に srcdoc がクリアされる
   713	- [ ] ダーク/ライトテーマでボタンスタイルが適切
   714	- [ ] MutationObserver が debounce (150ms) されている
   715	- [ ] 折り畳まれた diff でもボタンが機能する
   716	- [ ] エラーハンドリングのテストが通る
   717	- [ ] 10 ファイル以上の PR で動作確認
   718	
   719	### Phase 3 (拡張)
   720	
   721	- [ ] diff 下部にインライン iframe でプレビュー表示可能（`sandbox="allow-scripts"` + srcdoc）
   722	- [ ] インライン iframe でも相対 CSS/JS/画像が `<base>` タグにより正しく解決される
   723	- [ ] iframe のリサイズ（ドラッグ）が可能
   724	- [ ] Desktop/Tablet/Mobile の viewport 切替が動作する
   725	- [ ] PR ヘッダに「Preview All HTML」ボタンが表示される
   726	- [ ] `/blob/` ページでも Preview ボタンが表示される
   727	- [ ] 各拡張機能のテストが通る

codex
前回指摘の主眼である `preview.html` + `sandbox="allow-scripts"` 化、`window.open` の同期実行、`buildPreviewHtml()` の共通化は本文の主フローに反映されています。ただし、計画としてはまだ以下の問題があります。

1. `preview.html` への HTML 転送方式が成立していません。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:344) の `chrome.tabs.sendMessage` は content script 宛てで、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:375) の extension page `chrome.runtime.onMessage` 受信設計と噛み合っていません。さらに ready/ack がないため、`preview.html` 側の初期化前にメッセージ送信される取りこぼしも残ります。改善案は、background が `previewId -> html/status` を保持し、`preview.html` がロード後に `chrome.runtime.sendMessage({ type: 'preview-get', id })` で取得する方式、または `runtime.connect` で 1:1 ポート接続にすることです。あわせて fetch 失敗時の新規タブの扱いも未定義なので、blank のまま残さず error 表示か自動 close を仕様化した方がよいです。

2. `preview.html` のビルド経路が計画から漏れています。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:209) では `src/preview.html` / `src/preview.ts` を追加しますが、現状の [vite.config.ts](/workspace/vite.config.ts:8) は `background` と `options` しか build input に含めておらず、[vite.content.config.ts](/workspace/vite.content.config.ts:7) も content script 専用です。このままだと `chrome.runtime.getURL('preview.html')` で開くファイルも `assets/preview.js` も出力されません。改善案は、計画の変更ファイルに [vite.config.ts](/workspace/vite.config.ts) を追加し、`preview.html` を entry に含めること、または `preview.html` を `public/` に置くならその場合の JS 読み込み方法まで明記することです。

3. `<base>` 注入の実装案が脆く、DoD の「相対パス解決」を満たせないケースがあります。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:333) の文字列置換は lowercase の `<head>` 前提で、既存 `<base>`、`<HEAD>`、`<head>` なし、`<!DOCTYPE>` やコメント先頭の文書を正しく扱えません。`return \`<base ...>\${html}\`` も文書先頭に `base` を置くため不正です。改善案は `DOMParser` で文書化し、`document.head` に `base` を作成または置換してから serialize する方針に変更し、既存 `<base>` 上書きと `head` 不在時の生成を明記することです。

4. Blob URL 廃止が文書全体には反映しきれておらず、計画が自己矛盾しています。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:10)、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:30)、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:101)、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:640)、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:680) などに Blob URL 前提の記述が残っています。前回指摘の「反映確認」という観点ではここが未完了です。改善案は、Blob/CSP/Blob 解放の記述を `preview.html + srcdoc + message relay` 前提へ統一し、Phase 2 のテスト・リスク・状態遷移も同じ用語にそろえることです。

結論として、前回の大きな方向修正は反映されていますが、現時点では「問題なし」ではありません。特に 1 と 2 は実装着手前に詰めるべきです。
tokens used
44,910
前回指摘の主眼である `preview.html` + `sandbox="allow-scripts"` 化、`window.open` の同期実行、`buildPreviewHtml()` の共通化は本文の主フローに反映されています。ただし、計画としてはまだ以下の問題があります。

1. `preview.html` への HTML 転送方式が成立していません。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:344) の `chrome.tabs.sendMessage` は content script 宛てで、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:375) の extension page `chrome.runtime.onMessage` 受信設計と噛み合っていません。さらに ready/ack がないため、`preview.html` 側の初期化前にメッセージ送信される取りこぼしも残ります。改善案は、background が `previewId -> html/status` を保持し、`preview.html` がロード後に `chrome.runtime.sendMessage({ type: 'preview-get', id })` で取得する方式、または `runtime.connect` で 1:1 ポート接続にすることです。あわせて fetch 失敗時の新規タブの扱いも未定義なので、blank のまま残さず error 表示か自動 close を仕様化した方がよいです。

2. `preview.html` のビルド経路が計画から漏れています。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:209) では `src/preview.html` / `src/preview.ts` を追加しますが、現状の [vite.config.ts](/workspace/vite.config.ts:8) は `background` と `options` しか build input に含めておらず、[vite.content.config.ts](/workspace/vite.content.config.ts:7) も content script 専用です。このままだと `chrome.runtime.getURL('preview.html')` で開くファイルも `assets/preview.js` も出力されません。改善案は、計画の変更ファイルに [vite.config.ts](/workspace/vite.config.ts) を追加し、`preview.html` を entry に含めること、または `preview.html` を `public/` に置くならその場合の JS 読み込み方法まで明記することです。

3. `<base>` 注入の実装案が脆く、DoD の「相対パス解決」を満たせないケースがあります。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:333) の文字列置換は lowercase の `<head>` 前提で、既存 `<base>`、`<HEAD>`、`<head>` なし、`<!DOCTYPE>` やコメント先頭の文書を正しく扱えません。`return \`<base ...>\${html}\`` も文書先頭に `base` を置くため不正です。改善案は `DOMParser` で文書化し、`document.head` に `base` を作成または置換してから serialize する方針に変更し、既存 `<base>` 上書きと `head` 不在時の生成を明記することです。

4. Blob URL 廃止が文書全体には反映しきれておらず、計画が自己矛盾しています。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:10)、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:30)、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:101)、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:640)、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md:680) などに Blob URL 前提の記述が残っています。前回指摘の「反映確認」という観点ではここが未完了です。改善案は、Blob/CSP/Blob 解放の記述を `preview.html + srcdoc + message relay` 前提へ統一し、Phase 2 のテスト・リスク・状態遷移も同じ用語にそろえることです。

結論として、前回の大きな方向修正は反映されていますが、現時点では「問題なし」ではありません。特に 1 と 2 は実装着手前に詰めるべきです。
