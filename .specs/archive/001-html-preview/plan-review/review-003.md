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

exec
/bin/bash -lc "sed -n '1,260p' /workspace/plan-review/review-002.md" in /workspace
 exited 2 in 0ms:
sed: can't read /workspace/plan-review/review-002.md: No such file or directory

codex
実装計画の後半と前回レビュー本文を読みます。特に Blob URL 方式への統一が図・本文・テスト・DoD まで揃っているかを確認します。
exec
/bin/bash -lc "sed -n '261,520p' /workspace/.specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';

// GitHub のボタンスタイルに合わせる
const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
```

挿入位置: ファイルヘッダ内の `.file-actions` または `.file-info`、末尾にフォールバック。既存のアクションボタン群の隣に配置。

重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。

### 4.4 fetch + Blob + 新規タブ

Blob URL 方式で HTML を取得しプレビューする。`<base>` タグを注入してから Blob を作成することで相対パスを解決:

```typescript
async function fetchAndPreview(rawUrl: string): Promise<void> {
  const response = await fetch(rawUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();

  // <base> タグを注入して相対パスを解決
  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
  const htmlWithBase = injectBaseTag(html, baseUrl);

  const blob = new Blob([htmlWithBase], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
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

**ポップアップブロックについて**: Chrome 拡張のコンテンツスクリプトからの `window.open` は、ブラウザのポップアップブロッカーに引っかかりにくい（拡張機能は信頼されたコンテキスト）。万一ブロックされた場合は、ボタンに「ポップアップを許可してください」と表示してフォールバック。

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


exec
/bin/bash -lc "sed -n '1,260p' /workspace/.specs/001-html-preview/plan-review/review-002.md" in /workspace
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

codex
前回レビューの指摘本文を抽出します。今回の版に残っている懸念と、今回新たに入った仕様を切り分けます。
exec
/bin/bash -lc 'rg -n "''^'"\\d+\\. |CSP|document.write|Blob URL|noopener|問題なし|指摘|改善案|about:blank|iframe\" /workspace/.specs/001-html-preview/plan-review/review-002.md" in /workspace
 succeeded in 0ms:
19:前回のレビュー (plan-review/review-001.md) で以下の指摘があり、修正済みです:
20:1. セキュリティ方針の明文化（動的実行許可 + noopener + sandbox 制限）
21:2. 相対パス解決（<base> タグ注入）
22:3. ポップアップブロック回避（空タブを同期的に開く + document.write）
23:4. matches 拡大（/pull/* + runtime 判定 + turbo:load/popstate 対応）
24:5. URL ソースの一本化（View file リンクの href のみ使用）
25:6. DOM セレクタの整理（div[id^="diff-"] 除外、data-testid 不整合修正）
28:1. 前回の指摘が適切に反映されているか
29:2. 新たな仕様の曖昧さ・抜け漏れはないか
30:3. 実装可能性に問題はないか
31:4. エッジケースは考慮されているか
32:5. 全体アーキテクチャとの整合性はあるか
34:問題がなければ「問題なし」と回答してください。
35:問題があれば具体的な指摘と改善案を提示してください。
38:レビュー対象と前回指摘の反映状況を確認します。まず計画書と前回レビューを読み、差分観点で曖昧さ・実装不能要素・抜けを洗います。
46:GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。
51:- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、テーマ対応、debounce
52:- **Phase 3 (拡張)**: インライン iframe、viewport 切替、一括プレビュー、blob/ ページ対応
63:- **`window.open` には `noopener` を指定**: opener への参照を遮断する
64:- **Phase 3 の iframe は `sandbox="allow-scripts"`**: `allow-same-origin` は付与しない（Blob URL のため不要）
69:- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
175:#### Phase 3: インライン iframe プレビュー
191:     |                      | <iframe>         |
200:         ボタンから                   順次 fetch + iframe)
214:| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |
231:| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
232:| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
289:特殊文字の扱い: ブラウザが href を自動エンコード済みのため、追加の `encodeURI` は不要。`#` や `?` を含むファイル名は href のパース時に壊れる可能性があるが、GitHub がそれらを適切にエンコードした href を生成するため問題なし。
337:  const newTab = window.open('about:blank', '_blank', 'noopener');
352:  newTab.document.write(htmlWithBase);
435:### 5.2 Blob URL 解放
440:// 既存 Blob URL の管理マップ
444:  // 既存の Blob URL があれば解放
502:### 6.1 インライン iframe プレビュー
504:diff ブロックの直下に iframe を挿入:
512:  const iframe = document.createElement('iframe');
513:  iframe.src = blobUrl;
514:  iframe.style.cssText = `
522:  iframe.setAttribute('sandbox', 'allow-scripts');
523:  container.appendChild(iframe);
524:  return iframe;
537:| |          iframe preview              | |
610:1. 仕様の曖昧さ・抜け漏れはないか
611:2. 実装可能性に問題はないか
612:3. エッジケースは考慮されているか
613:4. ファイル構成は妥当か
614:5. 全体アーキテクチャとの整合性はあるか
616:問題がなければ「問題なし」と回答してください。
617:問題があれば具体的な指摘と改善案を提示してください。
628:GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。
633:- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、テーマ対応、debounce
634:- **Phase 3 (拡張)**: インライン iframe、viewport 切替、一括プレビュー、blob/ ページ対応
743:#### Phase 3: インライン iframe プレビュー
759:     |                      | <iframe>         |
768:         ボタンから                   順次 fetch + iframe)
782:| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |
799:| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
800:| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
873:前回のレビュー (plan-review/review-001.md) で以下の指摘があり、修正済みです:
874:1. セキュリティ方針の明文化（動的実行許可 + noopener + sandbox 制限）
875:2. 相対パス解決（<base> タグ注入）
876:3. ポップアップブロック回避（空タブを同期的に開く + document.write）
877:4. matches 拡大（/pull/* + runtime 判定 + turbo:load/popstate 対応）
878:5. URL ソースの一本化（View file リンクの href のみ使用）
879:6. DOM セレクタの整理（div[id^="diff-"] 除外、data-testid 不整合修正）
882:1. 前回の指摘が適切に反映されているか
883:2. 新たな仕様の曖昧さ・抜け漏れはないか
884:3. 実装可能性に問題はないか
885:4. エッジケースは考慮されているか
886:5. 全体アーキテクチャとの整合性はあるか
888:問題がなければ「問題なし」と回答してください。
889:問題があれば具体的な指摘と改善案を提示してください。
892:レビュー対象と前回指摘の反映状況を確認します。まず計画書と前回レビューを読み、差分観点で曖昧さ・実装不能要素・抜けを洗います。
900:GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。
905:- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、テーマ対応、debounce
906:- **Phase 3 (拡張)**: インライン iframe、viewport 切替、一括プレビュー、blob/ ページ対応
917:- **`window.open` には `noopener` を指定**: opener への参照を遮断する
918:- **Phase 3 の iframe は `sandbox="allow-scripts"`**: `allow-same-origin` は付与しない（Blob URL のため不要）
923:- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
1029:#### Phase 3: インライン iframe プレビュー
1045:     |                      | <iframe>         |
1054:         ボタンから                   順次 fetch + iframe)
1068:| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |
1093:// Blob URL
1111:| DOM 操作 | happy-dom で DOM 構築 -> 操作実行 -> DOM 状態検証 | preview-button, iframe-preview, viewport-toggle |
1128:  7. Blob URL 解放のテスト追加（html-fetcher.test.ts 拡張）
1133:  10. iframe-preview.test.ts
1168:| 大きな HTML ファイル | 低 | Blob 化は数百 KB でも問題なし。ローディング表示で UX 担保 |
1169:| CSP 制約 | 低 | Blob URL は CSP 制約を受けにくい（検証済み） |
1171:| Blob URL メモリリーク | 中 | タイマーベースの `revokeObjectURL` (30秒)。Phase 2 で対応 |
1175:| ポップアップブロック | 高 | クリック直後に空タブを同期的に開き、fetch 後に document.write で書き込む |
1177:| 外部 CDN 依存の JS | 低 | 通常通り CORS/CSP に従う。個別対応 |
1200:- [ ] Blob URL が 30 秒後に自動解放される
1209:- [ ] diff 下部にインライン iframe でプレビュー表示可能
1210:- [ ] iframe のリサイズ（ドラッグ）が可能
1422:指摘候補の位置を固めるため、該当箇所に行番号を付けて確認します。ここからは前回の修正反映だけでなく、今回残っている実装上の齟齬を絞ります。
1430:     5	GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。
1435:    10	- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、テーマ対応、debounce
1436:    11	- **Phase 3 (拡張)**: インライン iframe、viewport 切替、一括プレビュー、blob/ ページ対応
1447:    22	- **`window.open` には `noopener` を指定**: opener への参照を遮断する
1448:    23	- **Phase 3 の iframe は `sandbox="allow-scripts"`**: `allow-same-origin` は付与しない（Blob URL のため不要）
1453:    28	- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
1559:   134	#### Phase 3: インライン iframe プレビュー
1575:   150	     |                      | <iframe>         |
1584:   159	         ボタンから                   順次 fetch + iframe)
1598:   173	| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |
1615:   190	| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
1616:   191	| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
1673:   248	特殊文字の扱い: ブラウザが href を自動エンコード済みのため、追加の `encodeURI` は不要。`#` や `?` を含むファイル名は href のパース時に壊れる可能性があるが、GitHub がそれらを適切にエンコードした href を生成するため問題なし。
1700:   271	  const newTab = window.open('about:blank', '_blank', 'noopener');
1715:   286	  newTab.document.write(htmlWithBase);
1798:   369	### 5.2 Blob URL 解放
1803:   374	// 既存 Blob URL の管理マップ
1807:   378	  // 既存の Blob URL があれば解放
1865:   436	### 6.1 インライン iframe プレビュー
1867:   438	diff ブロックの直下に iframe を挿入:
1875:   446	  const iframe = document.createElement('iframe');
1876:   447	  iframe.src = blobUrl;
1877:   448	  iframe.style.cssText = `
1885:   456	  iframe.setAttribute('sandbox', 'allow-scripts');
1886:   457	  container.appendChild(iframe);
1887:   458	  return iframe;
1900:   471	| |          iframe preview              | |
1962:   533	// Blob URL
1980:   551	| DOM 操作 | happy-dom で DOM 構築 -> 操作実行 -> DOM 状態検証 | preview-button, iframe-preview, viewport-toggle |
1992:web search: MDN window.open noopener returns null
2000:/bin/bash -lc 'rg -n "noopener|window.open|raw/|blob URL|base href|Preview all|sandbox" /workspace/.specs/001-html-preview/exploration-report.md /workspace/docs/plan.md /workspace/.specs/001-html-preview/hearing-notes.md' in /workspace
2066:完全にスケルトン状態。hearing-notesで要求されている DOM 操作 (Preview ボタン追加、MutationObserver、fetch + Blob URL) は全て新規実装が必要。
2253:/workspace/.specs/001-html-preview/exploration-report.md:478:4. `preview.ts` + テスト: fetch + Blob URL + window.open
2263:web search: MDN about:blank inherits CSP opener
2267:前回の指摘 2-6 は概ね反映されています。ですが、1 は実装レベルでは未解決で、加えて新たなブロッカーが 1 点あります。
2269:- 重大: 現在のプレビュー方式は GitHub 側 CSP の継承を前提としておらず、`動的実行を許可する` という要件と衝突しています。[implementation-plan.md:21](/workspace/.specs/001-html-preview/implementation-plan.md#L21) [implementation-plan.md:266](/workspace/.specs/001-html-preview/implementation-plan.md#L266) [implementation-plan.md:436](/workspace/.specs/001-html-preview/implementation-plan.md#L436)
2270:  改善案: `about:blank` / `blob:` / `data:` のようなローカルスキームを使う前提をいったん設計上のリスクとして昇格し、GitHub の CSP を継承しないプレビュー面で本当に要件を満たせるかを先に検証してください。成立しない場合は、MVP 要件を「静的レンダリング確認」までに下げるか、別アーキテクチャに切り替える必要があります。
2272:- 重大: `window.open('about:blank', '_blank', 'noopener')` と `newTab.document.write(...)` は両立しません。`noopener` を付けると戻り値ハンドルに依存する現在の実装は成立しません。[implementation-plan.md:22](/workspace/.specs/001-html-preview/implementation-plan.md#L22) [implementation-plan.md:269](/workspace/.specs/001-html-preview/implementation-plan.md#L269)
2273:  改善案: `noopener` を維持するなら、書き込み可能な別方式に設計変更が必要です。逆に現在の `document.write` 方式を採るなら、`noopener` 方針をどう満たすかを別途明文化してください。
2275:- 中: レンダリング方式がまだ文書内で混在しています。Phase 1-2 の図は Blob URL 前提ですが、本文は `about:blank + document.write` 前提です。また Phase 2 の Blob URL 解放は新規タブ方式では使われず、Phase 3 の一括プレビューは説明では iframe 群なのにサンプルコードは `fetchHtmlAndOpen()` を呼んでいます。[implementation-plan.md:106](/workspace/.specs/001-html-preview/implementation-plan.md#L106) [implementation-plan.md:264](/workspace/.specs/001-html-preview/implementation-plan.md#L264) [implementation-plan.md:369](/workspace/.specs/001-html-preview/implementation-plan.md#L369) [implementation-plan.md:492](/workspace/.specs/001-html-preview/implementation-plan.md#L492)
2276:  改善案: フェーズごとに「どの描画面を使うか」を 1 つに固定し、図、本文、テスト、DoD を同じ前提にそろえてください。
2279:- MDN `window.open`: `noopener` 指定時は `null` を返す旨 https://developer.mozilla.org/en-US/docs/Web/API/Window/open
2280:- CSP Level 3: `about:blank` / `blob:` / `data:` / `document.write()` 可能な文書は元文書の CSP を継承 https://w3c.github.io/webappsec-csp/
2283:前回の指摘 2-6 は概ね反映されています。ですが、1 は実装レベルでは未解決で、加えて新たなブロッカーが 1 点あります。
2285:- 重大: 現在のプレビュー方式は GitHub 側 CSP の継承を前提としておらず、`動的実行を許可する` という要件と衝突しています。[implementation-plan.md:21](/workspace/.specs/001-html-preview/implementation-plan.md#L21) [implementation-plan.md:266](/workspace/.specs/001-html-preview/implementation-plan.md#L266) [implementation-plan.md:436](/workspace/.specs/001-html-preview/implementation-plan.md#L436)
2286:  改善案: `about:blank` / `blob:` / `data:` のようなローカルスキームを使う前提をいったん設計上のリスクとして昇格し、GitHub の CSP を継承しないプレビュー面で本当に要件を満たせるかを先に検証してください。成立しない場合は、MVP 要件を「静的レンダリング確認」までに下げるか、別アーキテクチャに切り替える必要があります。
2288:- 重大: `window.open('about:blank', '_blank', 'noopener')` と `newTab.document.write(...)` は両立しません。`noopener` を付けると戻り値ハンドルに依存する現在の実装は成立しません。[implementation-plan.md:22](/workspace/.specs/001-html-preview/implementation-plan.md#L22) [implementation-plan.md:269](/workspace/.specs/001-html-preview/implementation-plan.md#L269)
2289:  改善案: `noopener` を維持するなら、書き込み可能な別方式に設計変更が必要です。逆に現在の `document.write` 方式を採るなら、`noopener` 方針をどう満たすかを別途明文化してください。
2291:- 中: レンダリング方式がまだ文書内で混在しています。Phase 1-2 の図は Blob URL 前提ですが、本文は `about:blank + document.write` 前提です。また Phase 2 の Blob URL 解放は新規タブ方式では使われず、Phase 3 の一括プレビューは説明では iframe 群なのにサンプルコードは `fetchHtmlAndOpen()` を呼んでいます。[implementation-plan.md:106](/workspace/.specs/001-html-preview/implementation-plan.md#L106) [implementation-plan.md:264](/workspace/.specs/001-html-preview/implementation-plan.md#L264) [implementation-plan.md:369](/workspace/.specs/001-html-preview/implementation-plan.md#L369) [implementation-plan.md:492](/workspace/.specs/001-html-preview/implementation-plan.md#L492)
2292:  改善案: フェーズごとに「どの描画面を使うか」を 1 つに固定し、図、本文、テスト、DoD を同じ前提にそろえてください。
2295:- MDN `window.open`: `noopener` 指定時は `null` を返す旨 https://developer.mozilla.org/en-US/docs/Web/API/Window/open
2296:- CSP Level 3: `about:blank` / `blob:` / `data:` / `document.write()` 可能な文書は元文書の CSP を継承 https://w3c.github.io/webappsec-csp/

exec
/bin/bash -lc "sed -n '261,520p' /workspace/.specs/001-html-preview/plan-review/review-002.md" in /workspace
 succeeded in 0ms:
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

exec
/bin/bash -lc "sed -n '521,780p' /workspace/.specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
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
| ポップアップブロック | 中 | Chrome 拡張コンテンツスクリプトは信頼コンテキスト。万一ブロック時はユーザーに許可を案内 |
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

codex
計画書の整合性はほぼ把握しました。次に、実装可能性の観点で既存リポジトリの構成と計画の前提が噛み合うかだけ軽く確認します。
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
    22	- **Blob URL 方式を採用**: Blob URL は opaque origin を持ち、GitHub の CSP を継承しない（plan.md で検証済み）。opener からも github.com のコンテキストにアクセスできない
    23	- **Phase 3 の iframe は `sandbox="allow-scripts"`**: `allow-same-origin` は付与しない（Blob URL のため不要）
    24	- **ユーザーが意図的にプレビューする操作フロー**のため、untrusted HTML の実行リスクはユーザー判断に委ねる
    25	
    26	### 相対パス解決方針
    27	
    28	- Blob URL で HTML を開くと相対パス（CSS/JS/画像）が解決できない問題がある
    29	- **Phase 1**: `<base href>` タグを HTML の `<head>` に注入してから Blob を作成する。raw URL のディレクトリを基準 URL とする
    30	- 注入する base URL: `https://github.com/{owner}/{repo}/raw/{sha}/{dir}/`
    31	- これにより `./style.css` 等の相対参照が raw URL 経由で解決される
    32	
    33	### レンダリング方式
    34	
    35	- **Phase 1-2 (新規タブ)**: HTML に `<base>` 注入 → Blob 作成 → `URL.createObjectURL` → `window.open(blobUrl, '_blank')`
    36	- **Phase 3 (インライン)**: 同じ Blob URL を `<iframe src=blobUrl sandbox="allow-scripts">` で使用
    37	- **一貫して Blob URL 方式**を使用。`about:blank` + `document.write` は使わない（CSP 継承問題を回避）
    38	
    39	---
    40	
    41	## 2. システム図
    42	
    43	### 2.1 状態マシン図（コンテンツスクリプトのライフサイクル）
    44	
    45	```
    46	                          +-----------+
    47	                          |   IDLE    |
    48	                          | (初期状態) |
    49	                          +-----+-----+
    50	                                |
    51	                          page load / document_end
    52	                                |
    53	                                v
    54	                    +---------------------+
    55	                    |   OBSERVING         |
    56	                    | MutationObserver    |
    57	                    | 起動 + 初回スキャン   |
    58	                    +-----+--------+------+
    59	                          |        ^
    60	                 DOM変更検出 |        | debounce 後に再監視
    61	                          v        |
    62	                  +----------------+------+
    63	                  |  SCANNING             |
    64	                  |  ファイルヘッダ検出     |
    65	                  |  (.html判定)           |
    66	                  +---+------+------+-----+
    67	                      |      |      |
    68	            HTML なし  |      |      | エラー（DOM構造変更）
    69	            +---------+      |      +----------+
    70	            |                |                 |
    71	            v                v                 v
    72	     (OBSERVING       +------------+    +-----------+
    73	      に戻る)         | INSERTING  |    |   ERROR   |
    74	                      | ボタン挿入  |    | ログ出力   |
    75	                      +-----+------+    +-----+-----+
    76	                            |                 |
    77	                            v                 v
    78	                      +------------+    (OBSERVING
    79	                      |  WAITING   |     に戻る)
    80	                      | クリック待ち |
    81	                      +-----+------+
    82	                            |
    83	                      ユーザーがクリック
    84	                            |
    85	                            v
    86	                      +------------+
    87	                      |  FETCHING  |
    88	                      | raw HTML   |
    89	                      | fetch 実行  |
    90	                      +-----+------+
    91	                            |
    92	                +-----------+-----------+
    93	                |                       |
    94	          成功 (200)              失敗 / タイムアウト
    95	                |                       |
    96	                v                       v
    97	         +-------------+        +--------------+
    98	         |  PREVIEWING |        | FETCH_ERROR  |
    99	         | Blob生成     |        | ボタンに      |
   100	         | 新規タブ表示  |        | エラー表示    |
   101	         +------+------+        +------+-------+
   102	                |                       |
   103	                v                       v
   104	          (WAITING                (WAITING
   105	           に戻る)                 に戻る)
   106	```
   107	
   108	### 2.2 データフロー図
   109	
   110	#### Phase 1-2: 新規タブプレビュー
   111	
   112	```
   113	+----------+     click      +------------------+     fetch      +----------------+
   114	|  User    +--------------->| Content Script   +--------------->| github.com     |
   115	|          |                | (content.ts)     |  credentials:  | /raw/refs/     |
   116	+----------+                +--------+---------+  include       | heads/{branch} |
   117	                                     |                          | /{path}        |
   118	                                     |                          +-------+--------+
   119	                                     |                                  |
   120	                                     |                          302 redirect
   121	                                     |                                  |
   122	                                     |                                  v
   123	                                     |                          +----------------+
   124	                                     |                          | raw.github     |
   125	                                     |            response      | usercontent    |
   126	                                     |<-------------------------+ .com           |
   127	                                     |            (HTML text)   +----------------+
   128	                                     |
   129	                                     | injectBaseTag(html, baseUrl)
   130	                                     | new Blob([htmlWithBase], {type: 'text/html'})
   131	                                     | URL.createObjectURL(blob)
   132	                                     |
   133	                                     v
   134	                              +------+-------+
   135	                              | window.open  |
   136	                              | (blob:// URL)|
   137	                              | 新規タブ      |
   138	                              +--------------+
   139	```
   140	
   141	#### Phase 3: インライン iframe プレビュー
   142	
   143	```
   144	+----------+     click      +------------------+     fetch      +----------------+
   145	|  User    +--------------->| Content Script   +--------------->| github.com     |
   146	|          |                | (content.ts)     |                | /raw/...       |
   147	+----+-----+                +--------+---------+                +-------+--------+
   148	     |                               |                                  |
   149	     |                               |<---------------------------------+
   150	     |                               |  response (HTML text)
   151	     |                               |
   152	     |                               | new Blob([html], {type: 'text/html'})
   153	     |                               | URL.createObjectURL(blob)
   154	     |                               |
   155	     |                               v
   156	     |                      +--------+---------+
   157	     |                      | <iframe>         |
   158	     |    viewport toggle   | diff 直下に挿入   |
   159	     +--------------------->| src=blob:// URL  |
   160	     |   320px / 768px /    +--------+---------+
   161	     |   100%                        |
   162	     |                               |
   163	     |   "Open all HTML"             v
   164	     +------------------------> 一括プレビュー
   165	         PRヘッダの                  (全 .html ファイルを
   166	         ボタンから                   順次 fetch + iframe)
   167	```
   168	
   169	---
   170	
   171	## 3. ファイル構成
   172	
   173	### 変更ファイル
   174	
   175	| ファイル | 変更内容 |
   176	|---------|---------|
   177	| `public/manifest.json` | `name`, `description`, `matches`（`/pull/*` に拡大）, `permissions` の更新 |
   178	| `src/content.ts` | エントリポイントとして各モジュールを統合 |
   179	| `src/background.ts` | 必要に応じて設定管理を追加 |
   180	| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |
   181	
   182	### 新規ファイル
   183	
   184	| ファイル | 責務 |
   185	|---------|------|
   186	| `src/content/types.ts` | 共通型定義（ButtonState, FileHeaderInfo 等） |
   187	| `src/content/url-utils.ts` | URL 変換（blob -> raw）、`<base>` タグ注入。純粋関数 |
   188	| `src/content/url-utils.test.ts` | URL 変換のユニットテスト |
   189	| `src/content/github-dom.ts` | GitHub DOM セレクタ、ファイルヘッダ検出、HTML ファイル判定 |
   190	| `src/content/github-dom.test.ts` | DOM 検出のテスト（happy-dom） |
   191	| `src/content/preview-button.ts` | Preview ボタンの生成・挿入・重複防止・状態管理 |
   192	| `src/content/preview-button.test.ts` | ボタン挿入のテスト |
   193	| `src/content/html-fetcher.ts` | raw HTML の fetch + Blob 化 + window.open |
   194	| `src/content/html-fetcher.test.ts` | fetch フローのテスト（モック） |
   195	| `src/content/observer.ts` | MutationObserver + debounce |
   196	| `src/content/observer.test.ts` | Observer のテスト |
   197	| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
   198	| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
   199	| `src/content/viewport-toggle.ts` | Phase 3: viewport 切替 UI |
   200	| `src/content/viewport-toggle.test.ts` | Phase 3: viewport 切替のテスト |
   201	| `src/content/batch-preview.ts` | Phase 3: 一括プレビュー |
   202	| `src/content/batch-preview.test.ts` | Phase 3: 一括プレビューのテスト |
   203	
   204	---
   205	
   206	## 4. Phase 1 (MVP) 実装詳細
   207	
   208	### 4.1 DOM セレクタ戦略
   209	
   210	GitHub PR の Files changed タブのファイルヘッダ検出は、複数セレクタでフォールバックする:
   211	
   212	```typescript
   213	const FILE_HEADER_SELECTORS = [
   214	  '[data-tagsearch-path]',           // data属性ベース（最安定）
   215	  '.file-header[data-path]',         // クラス + data属性
   216	  '.file-header',                    // クラスのみ（フォールバック）
   217	] as const;
   218	```
   219	
   220	パス取得も複数戦略でフォールバック:
   221	
   222	```typescript
   223	const FILE_PATH_EXTRACTORS = [
   224	  (el: Element) => el.getAttribute('data-tagsearch-path'),
   225	  (el: Element) => el.getAttribute('data-path'),
   226	  (el: Element) => el.querySelector('[title]')?.getAttribute('title'),
   227	] as const;
   228	```
   229	
   230	検出優先順位: `data-*` 属性 > クラス名。`div[id^="diff-"]` は広すぎるため除外。
   231	
   232	**ページタイプ判定**: `matches` を `/pull/*` に広げるため、content script 内で URL パスから Files changed タブかどうかを runtime 判定する:
   233	
   234	```typescript
   235	function isFilesChangedTab(): boolean {
   236	  return /\/pull\/\d+\/files/.test(location.pathname);
   237	}
   238	```
   239	
   240	GitHub の PJAX/Turbo 遷移に対応するため、`popstate` イベントや `turbo:load` イベントも監視する。
   241	
   242	### 4.2 URL 変換
   243	
   244	**URL ソース**: "View file" リンク (`a[href*="/blob/"]`) の absolute href を唯一のソースとする。ファイルヘッダからの独自構築は行わない（fork PR やブランチ名に `/` を含むケースで壊れるため）。
   245	
   246	```
   247	入力: https://github.com/owner/repo/blob/{sha}/{path}
   248	出力: https://github.com/owner/repo/raw/{sha}/{path}
   249	
   250	変換: "/blob/" -> "/raw/" の単純置換
   251	```
   252	
   253	"View file" リンクが見つからないファイル（削除ファイル、rename の旧名側）は非対応とし、ボタンを挿入しない。
   254	
   255	特殊文字の扱い: ブラウザが href を自動エンコード済みのため、追加の `encodeURI` は不要。`#` や `?` を含むファイル名は href のパース時に壊れる可能性があるが、GitHub がそれらを適切にエンコードした href を生成するため問題なし。
   256	
   257	### 4.3 ボタン挿入
   258	
   259	```typescript
   260	// ボタンの識別用カスタム属性（重複防止）

exec
/bin/bash -lc "nl -ba /workspace/.specs/001-html-preview/implementation-plan.md | sed -n '261,520p'" in /workspace
 succeeded in 0ms:
   261	const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';
   262	
   263	// GitHub のボタンスタイルに合わせる
   264	const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
   265	```
   266	
   267	挿入位置: ファイルヘッダ内の `.file-actions` または `.file-info`、末尾にフォールバック。既存のアクションボタン群の隣に配置。
   268	
   269	重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。
   270	
   271	### 4.4 fetch + Blob + 新規タブ
   272	
   273	Blob URL 方式で HTML を取得しプレビューする。`<base>` タグを注入してから Blob を作成することで相対パスを解決:
   274	
   275	```typescript
   276	async function fetchAndPreview(rawUrl: string): Promise<void> {
   277	  const response = await fetch(rawUrl, { credentials: 'include' });
   278	  if (!response.ok) throw new Error(`HTTP ${response.status}`);
   279	  const html = await response.text();
   280	
   281	  // <base> タグを注入して相対パスを解決
   282	  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
   283	  const htmlWithBase = injectBaseTag(html, baseUrl);
   284	
   285	  const blob = new Blob([htmlWithBase], { type: 'text/html' });
   286	  const blobUrl = URL.createObjectURL(blob);
   287	  window.open(blobUrl, '_blank');
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
   303	**ポップアップブロックについて**: Chrome 拡張のコンテンツスクリプトからの `window.open` は、ブラウザのポップアップブロッカーに引っかかりにくい（拡張機能は信頼されたコンテキスト）。万一ブロックされた場合は、ボタンに「ポップアップを許可してください」と表示してフォールバック。
   304	
   305	### 4.5 MutationObserver
   306	
   307	GitHub PR は diff を遅延読み込みするため、DOM 変更を監視してボタンを挿入する。また、GitHub の PJAX/Turbo 遷移にも対応:
   308	
   309	```typescript
   310	const observer = new MutationObserver(() => {
   311	  if (isFilesChangedTab()) {
   312	    addPreviewButtons();
   313	  }
   314	});
   315	
   316	observer.observe(document.body, {
   317	  childList: true,
   318	  subtree: true,
   319	});
   320	
   321	// PJAX/Turbo 遷移対応
   322	document.addEventListener('turbo:load', () => {
   323	  if (isFilesChangedTab()) addPreviewButtons();
   324	});
   325	window.addEventListener('popstate', () => {
   326	  if (isFilesChangedTab()) addPreviewButtons();
   327	});
   328	
   329	// 初回スキャン
   330	if (isFilesChangedTab()) addPreviewButtons();
   331	```
   332	
   333	---
   334	
   335	## 5. Phase 2 (堅牢化) 実装詳細
   336	
   337	### 5.1 エラーハンドリング
   338	
   339	fetch 失敗時のユーザーフィードバック:
   340	
   341	```
   342	+------------------+     +-------------------+     +------------------+
   343	| fetch 実行       | --> | レスポンス判定     | --> | 成功: プレビュー  |
   344	+------------------+     +---+---------------+     +------------------+
   345	                             |
   346	                             | 失敗
   347	                             v
   348	                   +---------+----------+
   349	                   | エラー種別判定      |
   350	                   +--+------+------+---+
   351	                      |      |      |
   352	                      v      v      v
   353	                  network  401/   その他
   354	                  error    403
   355	                      |      |      |
   356	                      v      v      v
   357	                  "Network "Session "Preview
   358	                   error"  expired" failed"
   359	```
   360	
   361	ボタンの状態管理:
   362	
   363	```typescript
   364	type ButtonState = 'idle' | 'loading' | 'error';
   365	```
   366	
   367	ボタンのテキストを一時的にエラーメッセージに変更し、3秒後に復帰する。
   368	
   369	セッション切れ検知: レスポンスの URL がログインページにリダイレクトされた場合を判定。
   370	
   371	### 5.2 Blob URL 解放
   372	
   373	```typescript
   374	const BLOB_URL_LIFETIME_MS = 30_000; // 30秒
   375	
   376	// 既存 Blob URL の管理マップ
   377	const blobUrls: Map<string, { url: string; createdAt: number }> = new Map();
   378	
   379	function createManagedBlobUrl(blob: Blob, key: string): string {
   380	  // 既存の Blob URL があれば解放
   381	  const existing = blobUrls.get(key);
   382	  if (existing) URL.revokeObjectURL(existing.url);
   383	
   384	  const url = URL.createObjectURL(blob);
   385	  blobUrls.set(key, { url, createdAt: Date.now() });
   386	
   387	  setTimeout(() => {
   388	    URL.revokeObjectURL(url);
   389	    blobUrls.delete(key);
   390	  }, BLOB_URL_LIFETIME_MS);
   391	
   392	  return url;
   393	}
   394	```
   395	
   396	### 5.3 テーマ対応
   397	
   398	GitHub の `data-color-mode` 属性と既存 CSS 変数を活用:
   399	
   400	```typescript
   401	function getTheme(): 'light' | 'dark' {
   402	  return document.documentElement.getAttribute('data-color-mode') === 'dark'
   403	    ? 'dark' : 'light';
   404	}
   405	```
   406	
   407	GitHub ネイティブの `btn` クラスを使うことで基本的に自動追従する。カスタムスタイルが必要な場合のみ `--color-btn-bg`, `--color-btn-text` 等の CSS 変数を参照。
   408	
   409	### 5.4 debounce
   410	
   411	MutationObserver の過剰発火を抑制:
   412	
   413	```typescript
   414	function debounce<T extends (...args: unknown[]) => void>(
   415	  fn: T,
   416	  delay: number
   417	): T {
   418	  let timer: ReturnType<typeof setTimeout> | null = null;
   419	  return ((...args: unknown[]) => {
   420	    if (timer) clearTimeout(timer);
   421	    timer = setTimeout(() => fn(...args), delay);
   422	  }) as T;
   423	}
   424	
   425	// 使用: 150ms debounce
   426	const debouncedAddButtons = debounce(addPreviewButtons, 150);
   427	const observer = new MutationObserver(debouncedAddButtons);
   428	```
   429	
   430	### 5.5 折り畳み対応
   431	
   432	diff が collapsed 状態のファイルにもボタンを挿入。ファイルヘッダは折り畳み時も表示されるため、通常のセレクタで対応可能。
   433	
   434	---
   435	
   436	## 6. Phase 3 (拡張) 実装詳細
   437	
   438	### 6.1 インライン iframe プレビュー
   439	
   440	diff ブロックの直下に iframe を挿入:
   441	
   442	```typescript
   443	function createInlinePreview(
   444	  container: Element,
   445	  blobUrl: string,
   446	  viewportWidth: string
   447	): HTMLIFrameElement {
   448	  const iframe = document.createElement('iframe');
   449	  iframe.src = blobUrl;
   450	  iframe.style.cssText = `
   451	    width: ${viewportWidth};
   452	    height: 400px;
   453	    border: 1px solid var(--color-border-default);
   454	    border-radius: 6px;
   455	    resize: vertical;
   456	    overflow: auto;
   457	  `;
   458	  iframe.setAttribute('sandbox', 'allow-scripts');
   459	  container.appendChild(iframe);
   460	  return iframe;
   461	}
   462	```
   463	
   464	トグル動作: 「Inline Preview」ボタンをクリックで展開/折り畳み。
   465	
   466	### 6.2 viewport 切替
   467	
   468	```
   469	+------------------------------------------+
   470	| [Mobile 375px] [Tablet 768px] [Desktop]  |  <-- 切替 UI
   471	+------------------------------------------+
   472	| +--------------------------------------+ |
   473	| |          iframe preview              | |
   474	| |      (width 動的変更)                 | |
   475	| +--------------------------------------+ |
   476	+------------------------------------------+
   477	```
   478	
   479	プリセット:
   480	
   481	```typescript
   482	const VIEWPORTS = {
   483	  mobile:  { width: '375px',  label: 'Mobile' },
   484	  tablet:  { width: '768px',  label: 'Tablet' },
   485	  desktop: { width: '100%',   label: 'Desktop' },
   486	} as const;
   487	```
   488	
   489	### 6.3 一括プレビュー
   490	
   491	PR ヘッダ付近に「Preview all HTML files」ボタンを追加:
   492	
   493	```typescript
   494	async function previewAllHtml(): Promise<void> {
   495	  const htmlHeaders = findAllHtmlFileHeaders();
   496	  for (const header of htmlHeaders) {
   497	    const rawUrl = getRawUrlFromHeader(header);
   498	    if (!rawUrl) continue;
   499	    // 各ファイルの diff 下部にインライン iframe を展開
   500	    const container = getDiffContainer(header);
   501	    if (container) await fetchAndShowInline(rawUrl, container);
   502	  }
   503	}
   504	```
   505	
   506	### 6.4 blob/ ページ対応
   507	
   508	manifest.json の matches を拡張:
   509	
   510	```json
   511	{
   512	  "matches": [
   513	    "https://github.com/*/pull/*",
   514	    "https://github.com/*/blob/*/*.html"
   515	  ]
   516	}
   517	```
   518	
   519	`/blob/` ページでは既存の "Raw" ボタンの隣に "Preview" を追加。ページタイプに応じたセレクタを使い分け。
   520	

exec
/bin/bash -lc "rg --files /workspace | rg '("'^|/)(public/manifest'"\\.json|src/content\\.ts|src/background\\.ts|src/test/setup\\.ts|vite|package\\.json|pnpm-lock\\.yaml)"'$'"'" in /workspace
 succeeded in 0ms:
/workspace/pnpm-lock.yaml
/workspace/package.json
/workspace/src/background.ts
/workspace/src/content.ts
/workspace/public/manifest.json
/workspace/src/test/setup.ts

codex
1点だけ実装成立性の判断に不確実さがあるため、`window.open` のユーザー操作要件を一次情報で確認します。ここが曖昧なままだと MVP の成立条件に影響します。
web search: 
web search: MDN window.open transient activation asynchronous blocked user gesture
web search: 
web search: MDN blob URL origin opaque origin blob: navigation
web search: 
web search: https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob
web search: 
web search: Chrome content scripts isolated world origin same as page origin official docs
web search: 
web search: CSP blob URL navigation inherit CSP spec
codex
指摘候補の位置を固めるため、DoD とリスク表の行番号も確認します。最終的には重大度順で絞って返します。
exec
/bin/bash -lc "nl -ba /workspace/.specs/001-html-preview/implementation-plan.md | sed -n '521,700p'" in /workspace
 succeeded in 0ms:
   521	---
   522	
   523	## 7. テスト戦略
   524	
   525	### 7.1 テスト環境
   526	
   527	- **ランナー**: Vitest
   528	- **DOM 環境**: happy-dom
   529	- **モック基盤**: `src/test/setup.ts` で Chrome API + ブラウザ API をモック
   530	- **方針**: TDD（Red-Green-Refactor サイクル）
   531	
   532	### 7.2 追加モック（setup.ts に追加）
   533	
   534	```typescript
   535	// fetch モック
   536	vi.stubGlobal('fetch', vi.fn());
   537	
   538	// Blob URL
   539	const originalURL = globalThis.URL;
   540	vi.stubGlobal('URL', {
   541	  ...originalURL,
   542	  createObjectURL: vi.fn(() => 'blob:mock-url'),
   543	  revokeObjectURL: vi.fn(),
   544	});
   545	
   546	// window.open
   547	vi.stubGlobal('open', vi.fn());
   548	```
   549	
   550	### 7.3 機能タイプ分類とテストパターン
   551	
   552	| 機能タイプ | テスト方法 | 対象モジュール |
   553	|-----------|-----------|--------------|
   554	| 純粋関数 | 入力 -> 出力の検証。DOM 不要 | url-utils, debounce |
   555	| DOM 検出 | happy-dom で GitHub 風 DOM を構築 -> 関数実行 -> 結果検証 | github-dom |
   556	| DOM 操作 | happy-dom で DOM 構築 -> 操作実行 -> DOM 状態検証 | preview-button, iframe-preview, viewport-toggle |
   557	| 非同期 I/O | fetch モック -> 関数実行 -> モック呼び出し検証 | html-fetcher |
   558	| Observer | happy-dom の DOM 変更トリガー -> コールバック検証 | observer |
   559	| 統合 | 上記を組み合わせたフロー検証 | content.ts |
   560	
   561	### 7.4 テスト順序（TDD サイクル）
   562	
   563	```
   564	Phase 1:
   565	  1. url-utils.test.ts        <-- 純粋関数（最もテストしやすい）
   566	  2. github-dom.test.ts       <-- DOM 検出（happy-dom）
   567	  3. preview-button.test.ts   <-- DOM 操作
   568	  4. html-fetcher.test.ts     <-- fetch モック
   569	  5. observer.test.ts         <-- MutationObserver
   570	
   571	Phase 2:
   572	  6. エラーハンドリングのテスト追加（html-fetcher.test.ts 拡張）
   573	  7. Blob URL 解放のテスト追加（html-fetcher.test.ts 拡張）
   574	  8. debounce ユーティリティのテスト（observer.test.ts 拡張）
   575	  9. テーマ検出のテスト（github-dom.test.ts 拡張）
   576	
   577	Phase 3:
   578	  10. iframe-preview.test.ts
   579	  11. viewport-toggle.test.ts
   580	  12. batch-preview.test.ts
   581	```
   582	
   583	### 7.5 テストパターン詳細
   584	
   585	**純粋関数テスト（url-utils）**:
   586	- 正常系: `/blob/` -> `/raw/` 変換
   587	- 日本語パス、スペース、特殊文字
   588	- 不正な URL（/blob/ を含まない）
   589	
   590	**DOM 検出テスト（github-dom）**:
   591	- 各セレクタパターンでのファイルヘッダ検出
   592	- .html ファイルのフィルタリング
   593	- セレクタフォールバック
   594	
   595	**DOM 操作テスト（preview-button）**:
   596	- ボタン生成の属性・クラス検証
   597	- 挿入位置の検証
   598	- 重複防止
   599	
   600	**非同期 I/O テスト（html-fetcher）**:
   601	- fetch 成功 -> Blob 生成 -> window.open 呼び出し
   602	- fetch 失敗（ネットワークエラー、401、403、500）
   603	- セッション切れ（リダイレクト先がログインページ）
   604	
   605	---
   606	
   607	## 8. 技術的制約とリスク対策
   608	
   609	| リスク | 影響度 | 対策 |
   610	|-------|--------|------|
   611	| GitHub DOM 構造変更 | 高 | 複数セレクタでフォールバック。`data-*` 属性優先 |
   612	| セッション切れ | 中 | fetch レスポンスのステータスコード + URL 判定。ユーザー通知 |
   613	| 大きな HTML ファイル | 低 | Blob 化は数百 KB でも問題なし。ローディング表示で UX 担保 |
   614	| CSP 制約 | 低 | Blob URL は CSP 制約を受けにくい（検証済み） |
   615	| 日本語/特殊文字パス | 中 | GitHub が href をエンコード済み。追加エンコード不要。テストケースに含める |
   616	| Blob URL メモリリーク | 中 | タイマーベースの `revokeObjectURL` (30秒)。Phase 2 で対応 |
   617	| MutationObserver 過剰発火 | 中 | debounce (150ms)。Phase 2 で対応 |
   618	| コンテンツスクリプト IIFE 制約 | 低 | Vite がバンドル時に解決。ソースでは import 可能 |
   619	| 相対パス（CSS/JS/画像）の解決 | 高 | `<base href>` タグを HTML に注入し、raw URL ディレクトリを基準 URL とする |
   620	| ポップアップブロック | 中 | Chrome 拡張コンテンツスクリプトは信頼コンテキスト。万一ブロック時はユーザーに許可を案内 |
   621	| PJAX/Turbo 遷移 | 高 | `matches` を `/pull/*` に広げ、runtime で Files changed タブを判定。`turbo:load` + `popstate` イベント監視 |
   622	| 外部 CDN 依存の JS | 低 | 通常通り CORS/CSP に従う。個別対応 |
   623	
   624	---
   625	
   626	## 9. Definition of Done
   627	
   628	### Phase 1 (MVP)
   629	
   630	- [ ] `public/manifest.json` の matches が `https://github.com/*/pull/*` に設定されている
   631	- [ ] Files changed タブの runtime 判定が動作する（PJAX/Turbo 遷移対応）
   632	- [ ] `.html` ファイルのヘッダに「Preview」ボタンが表示される
   633	- [ ] ボタンクリックで新規タブに HTML がレンダリングされる（ポップアップブロック回避済み）
   634	- [ ] 相対パス（CSS/JS/画像）が `<base>` タグ注入により正しく解決される
   635	- [ ] 遅延読み込みされた diff にもボタンが挿入される（MutationObserver）
   636	- [ ] 重複ボタンが挿入されない
   637	- [ ] url-utils, github-dom, preview-button, html-fetcher, observer の全ユニットテストが Green
   638	- [ ] `pnpm build` が成功する
   639	- [ ] 3 ファイル以上の HTML を含む PR で動作確認
   640	
   641	### Phase 2 (堅牢化)
   642	
   643	- [ ] fetch 失敗時にボタン上にエラーメッセージが表示される
   644	- [ ] セッション切れが検知・通知される
   645	- [ ] Blob URL が 30 秒後に自動解放される
   646	- [ ] ダーク/ライトテーマでボタンスタイルが適切
   647	- [ ] MutationObserver が debounce (150ms) されている
   648	- [ ] 折り畳まれた diff でもボタンが機能する
   649	- [ ] エラーハンドリングのテストが通る
   650	- [ ] 10 ファイル以上の PR で動作確認
   651	
   652	### Phase 3 (拡張)
   653	
   654	- [ ] diff 下部にインライン iframe でプレビュー表示可能
   655	- [ ] iframe のリサイズ（ドラッグ）が可能
   656	- [ ] Desktop/Tablet/Mobile の viewport 切替が動作する
   657	- [ ] PR ヘッダに「Preview All HTML」ボタンが表示される
   658	- [ ] `/blob/` ページでも Preview ボタンが表示される
   659	- [ ] 各拡張機能のテストが通る

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

web search: 
web search: developer.chrome.com content scripts isolated world page origin same origin
web search: 
web search: MDN window.open direct response to user input transient activation
codex
以下の指摘があります。前回の `document.write` 廃止と Blob URL への統一自体は [implementation-plan.md:22](/workspace/.specs/001-html-preview/implementation-plan.md#L22) [implementation-plan.md:35](/workspace/.specs/001-html-preview/implementation-plan.md#L35) [implementation-plan.md:276](/workspace/.specs/001-html-preview/implementation-plan.md#L276) に反映されていますが、まだ実装ブロッカーになり得る点が残っています。

- 重大: Blob URL の安全性前提が不十分です。[implementation-plan.md:22](/workspace/.specs/001-html-preview/implementation-plan.md#L22) では「Blob URL は opaque origin で opener からも github.com にアクセスできない」としていますが、一次情報では Blob URL の origin は作成時の script origin に従います。Chrome も content script は extension origin ではなく page context / web origin 側で動くと説明しています。つまり、`window.open(blobUrl, '_blank')` で untrusted HTML を直接開く方式は、GitHub と同一 origin で実行される可能性を潰し切れていません。改善案は、新規タブは Blob URL 直開きではなく extension 管理下の `preview.html` を開き、その中の `sandbox="allow-scripts"` 付き iframe で描画する構成に切り替えることです。少なくともこの安全性は実装前に再検証が必要です。  
  Sources: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [File API: Origin of Blob URLs](https://w3c.github.io/FileAPI/TR.html#originOfBlobURL)

- 高: ポップアップブロック回避が未解決です。[implementation-plan.md:276](/workspace/.specs/001-html-preview/implementation-plan.md#L276) では `await fetch` 後に `window.open()` していますが、`window.open()` は user interaction 直下の transient activation が必要です。[implementation-plan.md:303](/workspace/.specs/001-html-preview/implementation-plan.md#L303) と [implementation-plan.md:620](/workspace/.specs/001-html-preview/implementation-plan.md#L620) の「拡張機能は信頼コンテキストなので引っかかりにくい」という整理では根拠が足りません。改善案は、クリック時に同期的に extension 側のプレビューページを開いておき、fetch 完了後にそのページへ内容を渡す方式にすることです。MVP を確実に通したいなら、Phase 1 をインライン iframe のみに寄せるのも選択肢です。  
  Source: [MDN `window.open()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/open)

- 中: 相対パス解決の仕様が Phase 3 で曖昧です。Phase 1 は [implementation-plan.md:29](/workspace/.specs/001-html-preview/implementation-plan.md#L29) と [implementation-plan.md:281](/workspace/.specs/001-html-preview/implementation-plan.md#L281) で `<base>` 注入が明記されていますが、Phase 3 側は図も DoD もその前提が抜けています。[implementation-plan.md:152](/workspace/.specs/001-html-preview/implementation-plan.md#L152) [implementation-plan.md:494](/workspace/.specs/001-html-preview/implementation-plan.md#L494) [implementation-plan.md:654](/workspace/.specs/001-html-preview/implementation-plan.md#L654) 改善案は、`buildPreviewBlob(rawUrl, html)` のような共通処理に `<base>` 注入を集約し、新規タブとインライン iframe の両方がそれを必ず使うと明文化することです。あわせて Phase 3 のテスト/DoD に「相対 CSS/JS/画像が inline preview でも解決される」を追加した方がよいです。
tokens used
102,329
以下の指摘があります。前回の `document.write` 廃止と Blob URL への統一自体は [implementation-plan.md:22](/workspace/.specs/001-html-preview/implementation-plan.md#L22) [implementation-plan.md:35](/workspace/.specs/001-html-preview/implementation-plan.md#L35) [implementation-plan.md:276](/workspace/.specs/001-html-preview/implementation-plan.md#L276) に反映されていますが、まだ実装ブロッカーになり得る点が残っています。

- 重大: Blob URL の安全性前提が不十分です。[implementation-plan.md:22](/workspace/.specs/001-html-preview/implementation-plan.md#L22) では「Blob URL は opaque origin で opener からも github.com にアクセスできない」としていますが、一次情報では Blob URL の origin は作成時の script origin に従います。Chrome も content script は extension origin ではなく page context / web origin 側で動くと説明しています。つまり、`window.open(blobUrl, '_blank')` で untrusted HTML を直接開く方式は、GitHub と同一 origin で実行される可能性を潰し切れていません。改善案は、新規タブは Blob URL 直開きではなく extension 管理下の `preview.html` を開き、その中の `sandbox="allow-scripts"` 付き iframe で描画する構成に切り替えることです。少なくともこの安全性は実装前に再検証が必要です。  
  Sources: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [File API: Origin of Blob URLs](https://w3c.github.io/FileAPI/TR.html#originOfBlobURL)

- 高: ポップアップブロック回避が未解決です。[implementation-plan.md:276](/workspace/.specs/001-html-preview/implementation-plan.md#L276) では `await fetch` 後に `window.open()` していますが、`window.open()` は user interaction 直下の transient activation が必要です。[implementation-plan.md:303](/workspace/.specs/001-html-preview/implementation-plan.md#L303) と [implementation-plan.md:620](/workspace/.specs/001-html-preview/implementation-plan.md#L620) の「拡張機能は信頼コンテキストなので引っかかりにくい」という整理では根拠が足りません。改善案は、クリック時に同期的に extension 側のプレビューページを開いておき、fetch 完了後にそのページへ内容を渡す方式にすることです。MVP を確実に通したいなら、Phase 1 をインライン iframe のみに寄せるのも選択肢です。  
  Source: [MDN `window.open()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/open)

- 中: 相対パス解決の仕様が Phase 3 で曖昧です。Phase 1 は [implementation-plan.md:29](/workspace/.specs/001-html-preview/implementation-plan.md#L29) と [implementation-plan.md:281](/workspace/.specs/001-html-preview/implementation-plan.md#L281) で `<base>` 注入が明記されていますが、Phase 3 側は図も DoD もその前提が抜けています。[implementation-plan.md:152](/workspace/.specs/001-html-preview/implementation-plan.md#L152) [implementation-plan.md:494](/workspace/.specs/001-html-preview/implementation-plan.md#L494) [implementation-plan.md:654](/workspace/.specs/001-html-preview/implementation-plan.md#L654) 改善案は、`buildPreviewBlob(rawUrl, html)` のような共通処理に `<base>` 注入を集約し、新規タブとインライン iframe の両方がそれを必ず使うと明文化することです。あわせて Phase 3 のテスト/DoD に「相対 CSS/JS/画像が inline preview でも解決される」を追加した方がよいです。
