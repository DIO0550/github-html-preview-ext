# Implementation Plan: GitHub PR HTML Preview

## 1. 概要

GitHub の Private repository の PR 画面（Files changed タブ）で、変更された HTML ファイルのヘッダに「Preview」ボタンを追加し、クリックするとログイン済みセッションクッキーを利用して raw HTML を取得し、新規タブまたはインライン iframe でレンダリング結果を確認できるようにする Chrome 拡張機能（Manifest V3）。

### スコープ

- **Phase 1 (MVP)**: Preview ボタン（新規タブ / インライン展開 / サイドパネル）+ MutationObserver + `/blob/` ページ対応
- **Phase 2 (堅牢化)**: エラーハンドリング、テーマ対応、debounce、メモリ管理
- **Phase 3 (拡張)**: viewport 切替、一括プレビュー

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
                              fetch  |                          ロード完了後
                            (async)  |                          preview-get を
                                     v                          ポーリング開始
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
                            .sendMessage(                               |
                              preview-store)                            |
                                    |                                   |
                                    v                                   |
                            +----------------+    preview-get           |
                            | Background     |<----(poll)---------------+
                            | previewStore   |                          |
                            | (Map)          +----response(html)------->|
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
| `public/manifest.json` | `name`, `description`, `matches`（`/pull/*` + `/blob/*/*.html`）, `permissions`, `web_accessible_resources`（preview.html）の更新 |
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
| `src/content/inline-preview.ts` | インライン iframe プレビュー（diff 下部に展開） |
| `src/content/inline-preview.test.ts` | インラインプレビューのテスト |
| `src/content/side-panel.ts` | サイドパネルプレビュー（ページ右側に展開） |
| `src/content/side-panel.test.ts` | サイドパネルのテスト |
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

**ページタイプ判定**: content script 内で URL パスからページ種別を runtime 判定する:

```typescript
type PageType = 'pr-files' | 'blob-html' | 'unknown';

function getPageType(): PageType {
  const path = location.pathname;
  if (/\/pull\/\d+\/files/.test(path)) return 'pr-files';
  if (/\/blob\/.*\.html$/.test(path)) return 'blob-html';
  return 'unknown';
}
```

- **pr-files**: PR の Files changed タブ → 各 .html ファイルヘッダに Preview ボタン挿入
- **blob-html**: 通常のファイル閲覧ページ（.html）→ ファイルヘッダの "Raw" ボタン隣に Preview ボタン挿入

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

  // DOCTYPE を復元して返す（quirks mode 防止）
  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}>`
    : '<!DOCTYPE html>';
  return doctype + '\n' + doc.documentElement.outerHTML;
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
  // PREVIEW_TIMEOUT_MS と同じ値を使用（タイムアウト設計値は一箇所で管理）
  const POLL_INTERVAL_MS = 200;
  const PREVIEW_TIMEOUT_MS = 60_000; // background の previewStore TTL と同じ
  const maxRetries = PREVIEW_TIMEOUT_MS / POLL_INTERVAL_MS; // 300回 = 60秒
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
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
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
  const pageType = getPageType();
  if (pageType !== 'unknown') {
    addPreviewButtons(pageType);
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// PJAX/Turbo 遷移対応
document.addEventListener('turbo:load', () => {
  const pageType = getPageType();
  if (pageType !== 'unknown') addPreviewButtons(pageType);
});
window.addEventListener('popstate', () => {
  const pageType = getPageType();
  if (pageType !== 'unknown') addPreviewButtons(pageType);
});

// 初回スキャン
const pageType = getPageType();
if (pageType !== 'unknown') addPreviewButtons(pageType);
```

### 4.6 blob ページ対応（通常のファイル閲覧）

`/blob/` ページでは PR の Files changed とは DOM 構造が異なる。ページタイプに応じたセレクタを使い分ける:

```typescript
function addPreviewButtons(pageType: PageType): void {
  if (pageType === 'pr-files') {
    addPreviewButtonsToPrFiles();
  } else if (pageType === 'blob-html') {
    addPreviewButtonToBlobPage();
  }
}
```

**blob ページのボタン挿入**:
- 現在表示中のファイルが `.html` であることは URL から判定済み（`getPageType` が `'blob-html'` を返した時点で確定）
- ファイルヘッダの "Raw" ボタン付近に Preview ボタンを挿入
- raw URL は "Raw" ボタンのリンク href、または URL の `/blob/` → `/raw/` 置換で取得

```typescript
function addPreviewButtonToBlobPage(): void {
  // 既に挿入済みならスキップ
  if (document.querySelector(PREVIEW_BUTTON_SELECTOR)) return;

  // "Raw" ボタンを探す
  const rawButton = document.querySelector('a[data-testid="raw-button"], a.btn-sm[href*="/raw/"]');
  if (!rawButton) return;

  const rawUrl = (rawButton as HTMLAnchorElement).href
    || location.href.replace('/blob/', '/raw/');

  const btn = createPreviewButton(() => fetchAndPreview(rawUrl));
  rawButton.parentElement?.insertBefore(btn, rawButton.nextSibling);
}
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

## 6. Phase 1 追加: インライン展開 + サイドパネル

### 6.1 プレビューモード

ユーザーは3つのプレビューモードを選択可能:

```
┌─ file.html ──────── [▶ Preview] [📄 Inline] [◫ Panel] ─┐
│  diff view                                               │
└──────────────────────────────────────────────────────────┘
```

- **▶ Preview**: 新規タブで開く（extension preview page 経由）
- **📄 Inline**: diff 下部にインライン iframe で展開/折り畳み
- **◫ Panel**: ページ右側にサイドパネルで表示

blob ページでは:
```
┌─ file.html ── [Raw] [▶ Preview] [📄 Inline] [◫ Panel] ─┐
```

### 6.2 インライン iframe プレビュー

diff ブロック（PR）またはファイルコンテンツ（blob ページ）の直下に iframe を挿入:

```typescript
function createInlinePreview(
  container: Element,
  html: string
): HTMLIFrameElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'html-preview-inline';
  wrapper.style.cssText = `
    border: 1px solid var(--color-border-default);
    border-radius: 6px;
    margin: 8px 0;
    overflow: hidden;
  `;

  const iframe = document.createElement('iframe');
  iframe.srcdoc = html;  // buildPreviewHtml で <base> 注入済み
  iframe.style.cssText = `
    width: 100%;
    height: 400px;
    border: none;
    resize: vertical;
    overflow: auto;
  `;
  iframe.setAttribute('sandbox', 'allow-scripts');

  wrapper.appendChild(iframe);
  container.appendChild(wrapper);
  return iframe;
}
```

トグル動作: 「Inline」ボタンをクリックで展開/折り畳み。再クリックで wrapper を `display: none` にする。

### 6.3 サイドパネルプレビュー

GitHub ページの右側にリサイズ可能なパネルを表示:

```
┌──── GitHub page ─────────────┬──── Preview Panel ────────┐
│                               │  ┌────────────────────┐  │
│  diff / blob content          │  │ (iframe: rendered)  │  │
│                               │  │                     │  │
│                               │  │                     │  │
│                               │  └────────────────────┘  │
│                               │  file.html               │
│                               │  [✕ Close]               │
└───────────────────────────────┴──────────────────────────┘
                              ↔ ドラッグでリサイズ
```

```typescript
function createSidePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'html-preview-panel';
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 40%;
    height: 100vh;
    background: var(--color-canvas-default);
    border-left: 1px solid var(--color-border-default);
    z-index: 100;
    display: flex;
    flex-direction: column;
    box-shadow: -2px 0 8px rgba(0,0,0,0.1);
  `;

  // リサイズハンドル（左端ドラッグ）
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 4px;
    height: 100%;
    cursor: col-resize;
  `;

  // ヘッダ（ファイル名 + 閉じるボタン）
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border-default);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `;

  // iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'html-preview-panel-iframe';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = 'flex: 1; border: none; width: 100%;';

  panel.appendChild(resizeHandle);
  panel.appendChild(header);
  panel.appendChild(iframe);
  document.body.appendChild(panel);

  // GitHub 本体のレイアウトを縮小
  document.body.style.marginRight = '40%';

  return panel;
}

function showInPanel(html: string, fileName: string): void {
  let panel = document.getElementById('html-preview-panel');
  if (!panel) panel = createSidePanel();

  const iframe = panel.querySelector('iframe')!;
  iframe.srcdoc = html;

  // ヘッダにファイル名を表示
  const header = panel.querySelector('div:nth-child(2)')!;
  header.innerHTML = `
    <span style="font-weight:600;">${fileName}</span>
    <button class="btn btn-sm" id="html-preview-panel-close">✕</button>
  `;
  document.getElementById('html-preview-panel-close')!
    .addEventListener('click', closeSidePanel);
}

function closeSidePanel(): void {
  const panel = document.getElementById('html-preview-panel');
  if (panel) {
    panel.remove();
    document.body.style.marginRight = '';
  }
}
```

リサイズ: ドラッグでパネル幅を変更。`mousedown` → `mousemove` → `mouseup` のイベントハンドリング。

### 6.4 共通 fetch フロー

3つのプレビューモードは全て同じ fetch + `<base>` 注入フローを共有:

```typescript
async function fetchPreviewHtml(rawUrl: string): Promise<string> {
  const response = await fetch(rawUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return buildPreviewHtml(rawUrl, html);
}

// 新規タブ: fetchAndPreview (preview page 経由)
// インライン: fetchPreviewHtml → createInlinePreview
// サイドパネル: fetchPreviewHtml → showInPanel
```

## 7. Phase 3 (拡張) 実装詳細

### 7.1 viewport 切替（インライン・サイドパネル共通）

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

インライン iframe とサイドパネル iframe の両方に適用可能。

### 7.2 一括プレビュー

PR ヘッダ付近に「Preview all HTML files」ボタンを追加:

```typescript
async function previewAllHtml(): Promise<void> {
  const htmlHeaders = findAllHtmlFileHeaders();
  for (const header of htmlHeaders) {
    const rawUrl = getRawUrlFromHeader(header);
    if (!rawUrl) continue;
    const container = getDiffContainer(header);
    if (container) {
      const html = await fetchPreviewHtml(rawUrl);
      createInlinePreview(container, html);
    }
  }
}
```

---

## 8. テスト戦略

### 7.1 テスト環境

- **ランナー**: Vitest
- **DOM 環境**: happy-dom
- **モック基盤**: `src/test/setup.ts` で Chrome API + ブラウザ API をモック
- **方針**: TDD（Red-Green-Refactor サイクル）

### 8.2 追加モック（setup.ts に追加）

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

### 8.3 機能タイプ分類とテストパターン

| 機能タイプ | テスト方法 | 対象モジュール |
|-----------|-----------|--------------|
| 純粋関数 | 入力 -> 出力の検証。DOM 不要 | url-utils, debounce |
| DOM 検出 | happy-dom で GitHub 風 DOM を構築 -> 関数実行 -> 結果検証 | github-dom |
| DOM 操作 | happy-dom で DOM 構築 -> 操作実行 -> DOM 状態検証 | preview-button, iframe-preview, viewport-toggle |
| 非同期 I/O | fetch モック -> 関数実行 -> モック呼び出し検証 | html-fetcher |
| Observer | happy-dom の DOM 変更トリガー -> コールバック検証 | observer |
| 統合 | 上記を組み合わせたフロー検証 | content.ts |

### 8.4 テスト順序（TDD サイクル）

```
Phase 1:
  1. url-utils.test.ts        <-- 純粋関数（最もテストしやすい）
  2. github-dom.test.ts       <-- DOM 検出（happy-dom）
  3. preview-button.test.ts   <-- DOM 操作
  4. html-fetcher.test.ts     <-- fetch モック
  5. observer.test.ts         <-- MutationObserver
  6. inline-preview.test.ts   <-- インライン iframe
  7. side-panel.test.ts       <-- サイドパネル

Phase 2:
  6. エラーハンドリングのテスト追加（html-fetcher.test.ts 拡張）
  7. preview page メッセージングのテスト追加（preview.test.ts）
  8. debounce ユーティリティのテスト（observer.test.ts 拡張）
  9. テーマ検出のテスト（github-dom.test.ts 拡張）

Phase 3:
  12. viewport-toggle.test.ts
  13. batch-preview.test.ts
```

### 8.5 テストパターン詳細

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

## 9. 技術的制約とリスク対策

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
| PJAX/Turbo 遷移 | 高 | `matches` を `/pull/*` + `/blob/*/*.html` に設定し、runtime でページタイプを判定。`turbo:load` + `popstate` イベント監視 |
| 外部 CDN 依存の JS | 低 | 通常通り CORS/CSP に従う。個別対応 |

---

## 10. Definition of Done

### Phase 1 (MVP)

- [ ] `public/manifest.json` の matches が `https://github.com/*/pull/*` と `https://github.com/*/blob/*/*.html` に設定されている
- [ ] Pages changed タブ + blob ページの runtime 判定が動作する（PJAX/Turbo 遷移対応）
- [ ] `/blob/` ページで .html ファイルの "Raw" ボタン隣に Preview ボタンが表示される
- [ ] `.html` ファイルのヘッダに「Preview」ボタンが表示される
- [ ] 「Preview」ボタンクリックで新規タブに HTML がレンダリングされる（extension preview page 経由）
- [ ] 「Inline」ボタンクリックで diff/ファイル下部にインライン iframe が展開/折り畳みされる
- [ ] 「Panel」ボタンクリックでページ右側にサイドパネルが表示される（リサイズ可能）
- [ ] 相対パス（CSS/JS/画像）が `<base>` タグ注入により正しく解決される（全モード共通）
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

- [ ] Desktop/Tablet/Mobile の viewport 切替がインライン・サイドパネル両方で動作する
- [ ] PR ヘッダに「Preview All HTML」ボタンが表示される（全 .html をインライン展開）
- [ ] 各拡張機能のテストが通る
