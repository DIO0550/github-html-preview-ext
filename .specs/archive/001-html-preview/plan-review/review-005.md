OpenAI Codex v0.117.0 (research preview)
--------
workdir: /workspace
model: gpt-5.4
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: none
session id: 019d5d5d-fe92-75a1-9cf6-703c41f2748b
--------
user
以下の実装計画をレビューしてください。

【重要】ファイルの作成・編集は一切行わないでください。レビュー結果は標準出力のみで回答してください。

レビュー対象: .specs/001-html-preview/implementation-plan.md

前回のレビュー (plan-review/review-004.md) で以下の指摘があり、修正済みです:
1. メッセージ転送: background が previewStore (Map) で previewId -> html を保持。preview.html がロード後に preview-get で取得する pull 方式に変更。fetch 失敗時はエラー情報を送信。
2. ビルド経路: vite.config.ts に preview.html を build input として追加を明記。変更ファイル一覧にも追加。
3. <base> 注入: DOMParser で安全に処理する方式に変更。既存 <base> の上書き、大文字 HEAD、head 不在を全て処理。
4. Blob URL 残存記述: 全て preview.html + srcdoc + message relay 方式の記述に統一。

問題がなければ「問題なし」と回答してください。
問題があれば具体的な指摘と改善案を提示してください。
warning: Codex could not find system bubblewrap at /usr/bin/bwrap. Please install bubblewrap with your package manager. Codex will use the vendored bubblewrap in the meantime.
codex
実装計画の整合性を確認します。まず対象計画を読み、必要なら関連ファイル構成だけ最小限確認して、指摘があれば根拠付きで返します。
exec
/bin/bash -lc "sed -n '1,260p' .specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
# Implementation Plan: GitHub PR HTML Preview

## 1. 概要

GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。

### スコープ

- **Phase 1 (MVP)**: Preview ボタン表示 + 新規タブプレビュー + MutationObserver
- **Phase 2 (堅牢化)**: エラーハンドリング、テーマ対応、debounce、メモリ管理
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

- srcdoc で HTML を渡す場合、相対パス（CSS/JS/画像）が解決できない問題がある
- **Phase 1**: DOMParser で `<base href>` タグを HTML に注入してから srcdoc として渡す。raw URL のディレクトリを基準 URL とする
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
         | preview page |        | ボタンに      |
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
| `src/background.ts` | preview HTML バッファ管理 + メッセージ API の追加 |
| `src/test/setup.ts` | Chrome API モック拡張（fetch, window.open, runtime.sendMessage/getURL/onMessage） |
| `vite.config.ts` | build input に `src/preview.html` を追加（options と同様に ES module としてビルド） |

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


exec
/bin/bash -lc "rg --files -g 'vite.config.ts' -g 'package.json' -g 'src/**' -g 'public/**' -g '*.html' ." in /workspace
 succeeded in 0ms:
./src/background.ts
./src/index.css
./src/content.ts
./package.json
./vite.config.ts
./src/test/setup.ts
./public/manifest.json
./src/options/App.tsx
./src/options/index.tsx
./src/options/index.html

codex
計画書の後半と既存のビルド構成も確認します。プレビュー経路と Manifest/Vite 記述が現在の構成に無理なく乗るかを見ます。
exec
/bin/bash -lc "sed -n '261,520p' .specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
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

重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。

### 4.4 fetch + preview page 連携

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
  // DOMParser で安全に <base> を注入（大文字 HEAD、既存 base、head なし等に対応）
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 既存の <base> があれば上書き、なければ新規作成
  let base = doc.querySelector('base');
  if (base) {
    base.href = baseUrl;
  } else {
    base = doc.createElement('base');
    base.href = baseUrl;
    // <head> がなければ自動生成されるので常に存在する
    doc.head.prepend(base);
  }

  return doc.documentElement.outerHTML;
}
```

```typescript
// background script 側（HTML バッファ + 取得 API）
const previewStore = new Map<string, { html: string | null; error: string | null }>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'preview-store') {
    // content script が fetch 完了後に HTML を保存
    previewStore.set(message.id, { html: message.html, error: message.error ?? null });
    sendResponse({ ok: true });
  } else if (message.type === 'preview-get') {
    // preview page がロード後に HTML を取得
    const data = previewStore.get(message.id);
    if (data) {
      previewStore.delete(message.id); // 取得後に削除
      sendResponse(data);
    } else {
      // まだ fetch 中の場合は pending を返す
      sendResponse({ html: null, error: null, pending: true });
    }
  }
  return true; // sendResponse を非同期で使うため
});
```

```typescript
// content script 側の送信部分（fetchAndPreview 内）
// fetch 完了後:
chrome.runtime.sendMessage({
  type: 'preview-store',
  id: previewId,
  html: htmlWithBase,
});
// fetch 失敗時:
chrome.runtime.sendMessage({
  type: 'preview-store',
  id: previewId,
  html: null,
  error: 'Fetch failed: ' + errorMessage,
});
```

```html
<!-- preview.html（src/preview.html → vite.config.ts でビルド → dist/ に出力）-->
<!DOCTYPE html>
<html>
<head><title>HTML Preview</title></head>
<body style="margin:0; height:100vh;">
  <div id="loading" style="display:flex; align-items:center; justify-content:center; height:100%; font-family:sans-serif; color:#666;">Loading preview...</div>
  <div id="error" style="display:none; padding:20px; color:red; font-family:sans-serif;"></div>
  <iframe id="preview" sandbox="allow-scripts" style="width:100%; height:100%; border:none; display:none;"></iframe>
  <script type="module" src="./preview.ts"></script>
</body>
</html>
```

```typescript
// preview.ts — preview page がロード後に background から HTML を取得
const params = new URLSearchParams(location.search);
const previewId = params.get('id');

async function loadPreview() {
  if (!previewId) return;

  // ポーリングで HTML が ready になるまで待つ（fetch 中の場合）
  const maxRetries = 50; // 50 * 200ms = 10秒
  for (let i = 0; i < maxRetries; i++) {
    const data = await chrome.runtime.sendMessage({
      type: 'preview-get',
      id: previewId,
    });

    if (data.html) {
      document.getElementById('loading')!.style.display = 'none';
      const iframe = document.getElementById('preview') as HTMLIFrameElement;
      iframe.style.display = 'block';
      iframe.srcdoc = data.html;
      return;
    }
    if (data.error) {
      document.getElementById('loading')!.style.display = 'none';
      const errorEl = document.getElementById('error')!;
      errorEl.style.display = 'block';
      errorEl.textContent = data.error;
      return;
    }
    // pending: まだ fetch 中
    await new Promise(r => setTimeout(r, 200));
  }
  // タイムアウト
  document.getElementById('loading')!.textContent = 'Preview timed out.';
}

loadPreview();
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

全フェーズで srcdoc 方式を使用するため Blob URL は不使用。

メモリ管理:
- **background の previewStore**: preview page が取得後に自動削除。タイムアウト(60秒)でも削除

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
/bin/bash -lc "sed -n '1,220p' vite.config.ts" in /workspace
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
/bin/bash -lc "sed -n '1,260p' src/background.ts" in /workspace
 succeeded in 0ms:
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

exec
/bin/bash -lc "sed -n '1,260p' package.json" in /workspace
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
/bin/bash -lc "sed -n '521,820p' .specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
- **インライン iframe**: 閉じたときに srcdoc をクリアしてメモリを解放
- **chrome.runtime.sendMessage のサイズ制限**: Chrome のメッセージサイズ上限は約 64MB。通常の HTML では問題なし

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
  7. preview page メッセージングのテスト追加（preview.test.ts）
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
| 大きな HTML ファイル | 低 | srcdoc で数百 KB でも問題なし。ローディング表示で UX 担保 |
| CSP 制約 | 低 | extension page + sandbox iframe は GitHub CSP の影響を受けない |
| 日本語/特殊文字パス | 中 | GitHub が href をエンコード済み。追加エンコード不要。テストケースに含める |
| メモリ管理 | 低 | srcdoc 方式。iframe 閉じ時に srcdoc クリア。background の previewStore は取得後に削除 |
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

exec
/bin/bash -lc "sed -n '1,260p' src/content.ts" in /workspace
 succeeded in 0ms:
// Content script
// This script runs in the context of web pages

console.log('Content script loaded');

exec
/bin/bash -lc "sed -n '1,260p' src/test/setup.ts" in /workspace
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

web search: 
web search: 
codex
ビルド実行経路に別設定があるかだけ確認します。ここが漏れると計画上は成立しても実装時に `content.js` や `preview.html` が出力されません。
exec
/bin/bash -lc "rg --files -g 'vite*.config.ts' ." in /workspace
 succeeded in 0ms:
./vite.content.config.ts
./vite.config.ts
./vitest.config.ts

exec
/bin/bash -lc "rg -n \"content\\.js|vite\\.content\\.config|rollupOptions|input\" -S ." in /workspace
 succeeded in 0ms:
./vite.content.config.ts:6:    rollupOptions: {
./vite.content.config.ts:7:      input: {
./vite.config.ts:8:    rollupOptions: {
./vite.config.ts:9:      input: {
./package.json:8:    "build": "tsc && vite build && vite build -c vite.content.config.ts",
./CLAUDE.md:25:- **`vite.content.config.ts`** — `src/content.ts` を IIFE 形式でビルド（Web ページに注入されるコンテンツスクリプトに必須）。`emptyOutDir: false` で最初のビルド出力を保持
./tailwind.config.js:10:        input: "hsl(var(--input))",
./public/manifest.json:19:        "assets/content.js"
./src/index.css:32:    --input: 214.3 31.8% 91.4%;
./src/index.css:64:    --input: 217.2 32.6% 17.5%;

exec
/bin/bash -lc "sed -n '1,220p' vite.content.config.ts" in /workspace
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

exec
/bin/bash -lc "sed -n '1,120p' CLAUDE.md" in /workspace
 succeeded in 0ms:
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

codex
メッセージ連携の説明に旧方式の記述が残っていないか洗います。ここは図と擬似コードがずれると、そのまま実装されやすい箇所です。
exec
/bin/bash -lc "rg -n \"preview-html|tabs\\.sendMessage|waiting for msg|background 経由で preview page に HTML を送信|previewStore|preview-get|preview-store\" .specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
121:                              fetch  |                          waiting for msg
298:     ), '_blank'                             {type: 'preview-html', id: xxx, html: htmlWithBase}
320:  // 4. background 経由で preview page に HTML を送信
322:    type: 'preview-html',
356:const previewStore = new Map<string, { html: string | null; error: string | null }>();
359:  if (message.type === 'preview-store') {
361:    previewStore.set(message.id, { html: message.html, error: message.error ?? null });
363:  } else if (message.type === 'preview-get') {
365:    const data = previewStore.get(message.id);
367:      previewStore.delete(message.id); // 取得後に削除
382:  type: 'preview-store',
388:  type: 'preview-store',
421:      type: 'preview-get',
520:- **background の previewStore**: preview page が取得後に自動削除。タイムアウト(60秒)でも削除
749:| メモリ管理 | 低 | srcdoc 方式。iframe 閉じ時に srcdoc クリア。background の previewStore は取得後に削除 |

exec
/bin/bash -lc "nl -ba .specs/001-html-preview/implementation-plan.md | sed -n '108,430p'" in /workspace
exec
/bin/bash -lc "nl -ba .specs/001-html-preview/implementation-plan.md | sed -n '330,360p'" in /workspace
 succeeded in 0ms:
   330	  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
   331	  return injectBaseTag(html, baseUrl);
   332	}
   333	
   334	function injectBaseTag(html: string, baseUrl: string): string {
   335	  // DOMParser で安全に <base> を注入（大文字 HEAD、既存 base、head なし等に対応）
   336	  const parser = new DOMParser();
   337	  const doc = parser.parseFromString(html, 'text/html');
   338	
   339	  // 既存の <base> があれば上書き、なければ新規作成
   340	  let base = doc.querySelector('base');
   341	  if (base) {
   342	    base.href = baseUrl;
   343	  } else {
   344	    base = doc.createElement('base');
   345	    base.href = baseUrl;
   346	    // <head> がなければ自動生成されるので常に存在する
   347	    doc.head.prepend(base);
   348	  }
   349	
   350	  return doc.documentElement.outerHTML;
   351	}
   352	```
   353	
   354	```typescript
   355	// background script 側（HTML バッファ + 取得 API）
   356	const previewStore = new Map<string, { html: string | null; error: string | null }>();
   357	
   358	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
   359	  if (message.type === 'preview-store') {
   360	    // content script が fetch 完了後に HTML を保存

 succeeded in 0ms:
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
   193	| `src/background.ts` | preview HTML バッファ管理 + メッセージ API の追加 |
   194	| `src/test/setup.ts` | Chrome API モック拡張（fetch, window.open, runtime.sendMessage/getURL/onMessage） |
   195	| `vite.config.ts` | build input に `src/preview.html` を追加（options と同様に ES module としてビルド） |
   196	
   197	### 新規ファイル
   198	
   199	| ファイル | 責務 |
   200	|---------|------|
   201	| `src/content/types.ts` | 共通型定義（ButtonState, FileHeaderInfo 等） |
   202	| `src/content/url-utils.ts` | URL 変換（blob -> raw）、`<base>` タグ注入。純粋関数 |
   203	| `src/content/url-utils.test.ts` | URL 変換のユニットテスト |
   204	| `src/content/github-dom.ts` | GitHub DOM セレクタ、ファイルヘッダ検出、HTML ファイル判定 |
   205	| `src/content/github-dom.test.ts` | DOM 検出のテスト（happy-dom） |
   206	| `src/content/preview-button.ts` | Preview ボタンの生成・挿入・重複防止・状態管理 |
   207	| `src/content/preview-button.test.ts` | ボタン挿入のテスト |
   208	| `src/content/html-fetcher.ts` | raw HTML の fetch + `<base>` 注入 + preview page 連携 |
   209	| `src/content/html-fetcher.test.ts` | fetch フローのテスト（モック） |
   210	| `src/preview.html` | extension preview page（sandboxed iframe でレンダリング） |
   211	| `src/preview.ts` | preview page のスクリプト（background からの HTML 受信 + iframe 書き込み） |
   212	| `src/content/observer.ts` | MutationObserver + debounce |
   213	| `src/content/observer.test.ts` | Observer のテスト |
   214	| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
   215	| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
   216	| `src/content/viewport-toggle.ts` | Phase 3: viewport 切替 UI |
   217	| `src/content/viewport-toggle.test.ts` | Phase 3: viewport 切替のテスト |
   218	| `src/content/batch-preview.ts` | Phase 3: 一括プレビュー |
   219	| `src/content/batch-preview.test.ts` | Phase 3: 一括プレビューのテスト |
   220	
   221	---
   222	
   223	## 4. Phase 1 (MVP) 実装詳細
   224	
   225	### 4.1 DOM セレクタ戦略
   226	
   227	GitHub PR の Files changed タブのファイルヘッダ検出は、複数セレクタでフォールバックする:
   228	
   229	```typescript
   230	const FILE_HEADER_SELECTORS = [
   231	  '[data-tagsearch-path]',           // data属性ベース（最安定）
   232	  '.file-header[data-path]',         // クラス + data属性
   233	  '.file-header',                    // クラスのみ（フォールバック）
   234	] as const;
   235	```
   236	
   237	パス取得も複数戦略でフォールバック:
   238	
   239	```typescript
   240	const FILE_PATH_EXTRACTORS = [
   241	  (el: Element) => el.getAttribute('data-tagsearch-path'),
   242	  (el: Element) => el.getAttribute('data-path'),
   243	  (el: Element) => el.querySelector('[title]')?.getAttribute('title'),
   244	] as const;
   245	```
   246	
   247	検出優先順位: `data-*` 属性 > クラス名。`div[id^="diff-"]` は広すぎるため除外。
   248	
   249	**ページタイプ判定**: `matches` を `/pull/*` に広げるため、content script 内で URL パスから Files changed タブかどうかを runtime 判定する:
   250	
   251	```typescript
   252	function isFilesChangedTab(): boolean {
   253	  return /\/pull\/\d+\/files/.test(location.pathname);
   254	}
   255	```
   256	
   257	GitHub の PJAX/Turbo 遷移に対応するため、`popstate` イベントや `turbo:load` イベントも監視する。
   258	
   259	### 4.2 URL 変換
   260	
   261	**URL ソース**: "View file" リンク (`a[href*="/blob/"]`) の absolute href を唯一のソースとする。ファイルヘッダからの独自構築は行わない（fork PR やブランチ名に `/` を含むケースで壊れるため）。
   262	
   263	```
   264	入力: https://github.com/owner/repo/blob/{sha}/{path}
   265	出力: https://github.com/owner/repo/raw/{sha}/{path}
   266	
   267	変換: "/blob/" -> "/raw/" の単純置換
   268	```
   269	
   270	"View file" リンクが見つからないファイル（削除ファイル、rename の旧名側）は非対応とし、ボタンを挿入しない。
   271	
   272	特殊文字の扱い: ブラウザが href を自動エンコード済みのため、追加の `encodeURI` は不要。`#` や `?` を含むファイル名は href のパース時に壊れる可能性があるが、GitHub がそれらを適切にエンコードした href を生成するため問題なし。
   273	
   274	### 4.3 ボタン挿入
   275	
   276	```typescript
   277	// ボタンの識別用カスタム属性（重複防止）
   278	const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';
   279	
   280	// GitHub のボタンスタイルに合わせる
   281	const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
   282	```
   283	
   284	挿入位置: ファイルヘッダ内の `.file-actions` または `.file-info`、末尾にフォールバック。既存のアクションボタン群の隣に配置。
   285	
   286	重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。
   287	
   288	### 4.4 fetch + preview page 連携
   289	
   290	Extension の preview page を経由する方式。ポップアップブロック回避と origin 隔離を両立:
   291	
   292	```
   293	クリックイベント（同期）                     非同期処理
   294	──────────────────                     ─────────────
   295	1. window.open(                        3. content script: fetch(rawUrl)
   296	     chrome.runtime.getURL(            4. content script: injectBaseTag(html)
   297	       'preview.html?id=xxx'           5. content script: chrome.runtime.sendMessage(
   298	     ), '_blank'                             {type: 'preview-html', id: xxx, html: htmlWithBase}
   299	   )                                       )
   300	2. preview.html がロード開始            6. background: タブIDへメッセージ転送
   301	                                       7. preview.html: iframe.srcdoc = html
   302	```
   303	
   304	```typescript
   305	// content script 側
   306	async function fetchAndPreview(rawUrl: string): Promise<void> {
   307	  // 1. クリックイベント内で同期的に preview page を開く（ポップアップブロック回避）
   308	  const previewId = crypto.randomUUID();
   309	  const previewUrl = chrome.runtime.getURL(`preview.html?id=${previewId}`);
   310	  window.open(previewUrl, '_blank');
   311	
   312	  // 2. raw HTML を取得
   313	  const response = await fetch(rawUrl, { credentials: 'include' });
   314	  if (!response.ok) throw new Error(`HTTP ${response.status}`);
   315	  const html = await response.text();
   316	
   317	  // 3. <base> タグを注入して相対パスを解決
   318	  const htmlWithBase = buildPreviewHtml(rawUrl, html);
   319	
   320	  // 4. background 経由で preview page に HTML を送信
   321	  chrome.runtime.sendMessage({
   322	    type: 'preview-html',
   323	    id: previewId,
   324	    html: htmlWithBase,
   325	  });
   326	}
   327	
   328	// 共通処理: <base> タグ注入（新規タブ・inline iframe 両方で使用）
   329	function buildPreviewHtml(rawUrl: string, html: string): string {
   330	  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
   331	  return injectBaseTag(html, baseUrl);
   332	}
   333	
   334	function injectBaseTag(html: string, baseUrl: string): string {
   335	  // DOMParser で安全に <base> を注入（大文字 HEAD、既存 base、head なし等に対応）
   336	  const parser = new DOMParser();
   337	  const doc = parser.parseFromString(html, 'text/html');
   338	
   339	  // 既存の <base> があれば上書き、なければ新規作成
   340	  let base = doc.querySelector('base');
   341	  if (base) {
   342	    base.href = baseUrl;
   343	  } else {
   344	    base = doc.createElement('base');
   345	    base.href = baseUrl;
   346	    // <head> がなければ自動生成されるので常に存在する
   347	    doc.head.prepend(base);
   348	  }
   349	
   350	  return doc.documentElement.outerHTML;
   351	}
   352	```
   353	
   354	```typescript
   355	// background script 側（HTML バッファ + 取得 API）
   356	const previewStore = new Map<string, { html: string | null; error: string | null }>();
   357	
   358	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
   359	  if (message.type === 'preview-store') {
   360	    // content script が fetch 完了後に HTML を保存
   361	    previewStore.set(message.id, { html: message.html, error: message.error ?? null });
   362	    sendResponse({ ok: true });
   363	  } else if (message.type === 'preview-get') {
   364	    // preview page がロード後に HTML を取得
   365	    const data = previewStore.get(message.id);
   366	    if (data) {
   367	      previewStore.delete(message.id); // 取得後に削除
   368	      sendResponse(data);
   369	    } else {
   370	      // まだ fetch 中の場合は pending を返す
   371	      sendResponse({ html: null, error: null, pending: true });
   372	    }
   373	  }
   374	  return true; // sendResponse を非同期で使うため
   375	});
   376	```
   377	
   378	```typescript
   379	// content script 側の送信部分（fetchAndPreview 内）
   380	// fetch 完了後:
   381	chrome.runtime.sendMessage({
   382	  type: 'preview-store',
   383	  id: previewId,
   384	  html: htmlWithBase,
   385	});
   386	// fetch 失敗時:
   387	chrome.runtime.sendMessage({
   388	  type: 'preview-store',
   389	  id: previewId,
   390	  html: null,
   391	  error: 'Fetch failed: ' + errorMessage,
   392	});
   393	```
   394	
   395	```html
   396	<!-- preview.html（src/preview.html → vite.config.ts でビルド → dist/ に出力）-->
   397	<!DOCTYPE html>
   398	<html>
   399	<head><title>HTML Preview</title></head>
   400	<body style="margin:0; height:100vh;">
   401	  <div id="loading" style="display:flex; align-items:center; justify-content:center; height:100%; font-family:sans-serif; color:#666;">Loading preview...</div>
   402	  <div id="error" style="display:none; padding:20px; color:red; font-family:sans-serif;"></div>
   403	  <iframe id="preview" sandbox="allow-scripts" style="width:100%; height:100%; border:none; display:none;"></iframe>
   404	  <script type="module" src="./preview.ts"></script>
   405	</body>
   406	</html>
   407	```
   408	
   409	```typescript
   410	// preview.ts — preview page がロード後に background から HTML を取得
   411	const params = new URLSearchParams(location.search);
   412	const previewId = params.get('id');
   413	
   414	async function loadPreview() {
   415	  if (!previewId) return;
   416	
   417	  // ポーリングで HTML が ready になるまで待つ（fetch 中の場合）
   418	  const maxRetries = 50; // 50 * 200ms = 10秒
   419	  for (let i = 0; i < maxRetries; i++) {
   420	    const data = await chrome.runtime.sendMessage({
   421	      type: 'preview-get',
   422	      id: previewId,
   423	    });
   424	
   425	    if (data.html) {
   426	      document.getElementById('loading')!.style.display = 'none';
   427	      const iframe = document.getElementById('preview') as HTMLIFrameElement;
   428	      iframe.style.display = 'block';
   429	      iframe.srcdoc = data.html;
   430	      return;

exec
/bin/bash -lc "rg -n \"preview\\.test|preview page\" .specs/001-html-preview/implementation-plan.md" in /workspace
 succeeded in 0ms:
22:- **extension preview page + sandbox iframe 方式**: content script が直接 Blob URL を開くと github.com origin になる問題を回避するため、extension 管理の `preview.html` ページ内の `sandbox="allow-scripts"` 付き iframe でレンダリングする。これにより:
101:         | preview page |        | ボタンに      |
112:#### Phase 1-2: 新規タブプレビュー（extension preview page 経由）
208:| `src/content/html-fetcher.ts` | raw HTML の fetch + `<base>` 注入 + preview page 連携 |
210:| `src/preview.html` | extension preview page（sandboxed iframe でレンダリング） |
211:| `src/preview.ts` | preview page のスクリプト（background からの HTML 受信 + iframe 書き込み） |
215:| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
219:| `src/content/batch-preview.test.ts` | Phase 3: 一括プレビューのテスト |
288:### 4.4 fetch + preview page 連携
290:Extension の preview page を経由する方式。ポップアップブロック回避と origin 隔離を両立:
307:  // 1. クリックイベント内で同期的に preview page を開く（ポップアップブロック回避）
320:  // 4. background 経由で preview page に HTML を送信
364:    // preview page がロード後に HTML を取得
410:// preview.ts — preview page がロード後に background から HTML を取得
520:- **background の previewStore**: preview page が取得後に自動削除。タイムアウト(60秒)でも削除
706:  7. preview page メッセージングのテスト追加（preview.test.ts）
711:  10. iframe-preview.test.ts
713:  12. batch-preview.test.ts

exec
/bin/bash -lc "nl -ba .specs/001-html-preview/implementation-plan.md | sed -n '690,715p'" in /workspace
 succeeded in 0ms:
   690	| 非同期 I/O | fetch モック -> 関数実行 -> モック呼び出し検証 | html-fetcher |
   691	| Observer | happy-dom の DOM 変更トリガー -> コールバック検証 | observer |
   692	| 統合 | 上記を組み合わせたフロー検証 | content.ts |
   693	
   694	### 7.4 テスト順序（TDD サイクル）
   695	
   696	```
   697	Phase 1:
   698	  1. url-utils.test.ts        <-- 純粋関数（最もテストしやすい）
   699	  2. github-dom.test.ts       <-- DOM 検出（happy-dom）
   700	  3. preview-button.test.ts   <-- DOM 操作
   701	  4. html-fetcher.test.ts     <-- fetch モック
   702	  5. observer.test.ts         <-- MutationObserver
   703	
   704	Phase 2:
   705	  6. エラーハンドリングのテスト追加（html-fetcher.test.ts 拡張）
   706	  7. preview page メッセージングのテスト追加（preview.test.ts）
   707	  8. debounce ユーティリティのテスト（observer.test.ts 拡張）
   708	  9. テーマ検出のテスト（github-dom.test.ts 拡張）
   709	
   710	Phase 3:
   711	  10. iframe-preview.test.ts
   712	  11. viewport-toggle.test.ts
   713	  12. batch-preview.test.ts
   714	```
   715	

exec
/bin/bash -lc "nl -ba .specs/001-html-preview/implementation-plan.md | sed -n '414,446p'" in /workspace
 succeeded in 0ms:
   414	async function loadPreview() {
   415	  if (!previewId) return;
   416	
   417	  // ポーリングで HTML が ready になるまで待つ（fetch 中の場合）
   418	  const maxRetries = 50; // 50 * 200ms = 10秒
   419	  for (let i = 0; i < maxRetries; i++) {
   420	    const data = await chrome.runtime.sendMessage({
   421	      type: 'preview-get',
   422	      id: previewId,
   423	    });
   424	
   425	    if (data.html) {
   426	      document.getElementById('loading')!.style.display = 'none';
   427	      const iframe = document.getElementById('preview') as HTMLIFrameElement;
   428	      iframe.style.display = 'block';
   429	      iframe.srcdoc = data.html;
   430	      return;
   431	    }
   432	    if (data.error) {
   433	      document.getElementById('loading')!.style.display = 'none';
   434	      const errorEl = document.getElementById('error')!;
   435	      errorEl.style.display = 'block';
   436	      errorEl.textContent = data.error;
   437	      return;
   438	    }
   439	    // pending: まだ fetch 中
   440	    await new Promise(r => setTimeout(r, 200));
   441	  }
   442	  // タイムアウト
   443	  document.getElementById('loading')!.textContent = 'Preview timed out.';
   444	}
   445	
   446	loadPreview();

exec
/bin/bash -lc "nl -ba .specs/001-html-preview/implementation-plan.md | sed -n '516,523p'" in /workspace
 succeeded in 0ms:
   516	
   517	全フェーズで srcdoc 方式を使用するため Blob URL は不使用。
   518	
   519	メモリ管理:
   520	- **background の previewStore**: preview page が取得後に自動削除。タイムアウト(60秒)でも削除
   521	- **インライン iframe**: 閉じたときに srcdoc をクリアしてメモリを解放
   522	- **chrome.runtime.sendMessage のサイズ制限**: Chrome のメッセージサイズ上限は約 64MB。通常の HTML では問題なし
   523	

codex
以下の点は修正した方がよいです。

1. 高: メッセージ連携の説明がまだ自己矛盾しています。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L112) では `waiting for msg` と `chrome.tabs.sendMessage` の push 方式、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L292) でも `preview-html` を background から転送する流れになっていますが、後半の擬似コードは `preview-store` / `preview-get` の pull 方式です。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L356)  
改善案: 2.2 と 4.4 を全面的に pull 方式へ統一してください。`preview.html` は「message を待つ」のではなく「background へ `preview-get` をポーリングする」、content script は `preview-store` のみ送る、という記述に揃えるべきです。

2. 中: `<base>` 注入後の返却値が `doc.documentElement.outerHTML` になっており、DOCTYPE が落ちます。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L334) これだと preview が quirks mode になり、実ページとレンダリング差異が出ます。  
改善案: 元の doctype を保持して返す方針を明記してください。少なくとも `<!DOCTYPE html>` を先頭に付けて返す、可能なら `doc.doctype` を復元してから `documentElement.outerHTML` を連結する形が安全です。

3. 中: preview 側の待機時間 10 秒と background 側の保持時間 60 秒が噛み合っていません。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L417) [implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L520) 遅い回線や大きめの HTML で preview.html が先にタイムアウトし、あとから `previewStore` に到着しても表示されないケースが出ます。  
改善案: preview の待機上限を store TTL に合わせるか、`pending` の間は明示的な retry/refresh を提供してください。少なくとも timeout の設計値は一箇所で管理する前提にした方がよいです。

上記 3 点を除けば、前回指摘の修正方針自体は概ね妥当です。
tokens used
40,020
以下の点は修正した方がよいです。

1. 高: メッセージ連携の説明がまだ自己矛盾しています。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L112) では `waiting for msg` と `chrome.tabs.sendMessage` の push 方式、[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L292) でも `preview-html` を background から転送する流れになっていますが、後半の擬似コードは `preview-store` / `preview-get` の pull 方式です。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L356)  
改善案: 2.2 と 4.4 を全面的に pull 方式へ統一してください。`preview.html` は「message を待つ」のではなく「background へ `preview-get` をポーリングする」、content script は `preview-store` のみ送る、という記述に揃えるべきです。

2. 中: `<base>` 注入後の返却値が `doc.documentElement.outerHTML` になっており、DOCTYPE が落ちます。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L334) これだと preview が quirks mode になり、実ページとレンダリング差異が出ます。  
改善案: 元の doctype を保持して返す方針を明記してください。少なくとも `<!DOCTYPE html>` を先頭に付けて返す、可能なら `doc.doctype` を復元してから `documentElement.outerHTML` を連結する形が安全です。

3. 中: preview 側の待機時間 10 秒と background 側の保持時間 60 秒が噛み合っていません。[implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L417) [implementation-plan.md](/workspace/.specs/001-html-preview/implementation-plan.md#L520) 遅い回線や大きめの HTML で preview.html が先にタイムアウトし、あとから `previewStore` に到着しても表示されないケースが出ます。  
改善案: preview の待機上限を store TTL に合わせるか、`pending` の間は明示的な retry/refresh を提供してください。少なくとも timeout の設計値は一箇所で管理する前提にした方がよいです。

上記 3 点を除けば、前回指摘の修正方針自体は概ね妥当です。
