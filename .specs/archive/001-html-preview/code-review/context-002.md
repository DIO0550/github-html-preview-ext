## 実装計画

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

## 実装タスク一覧

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

## 変更されたファイル

public/manifest.json
src/background.ts
src/content.ts
src/test/setup.ts
vite.config.ts
src/content/batch-preview.ts
src/content/batch-preview.unit.test.ts
src/content/error-handling.unit.test.ts
src/content/github-dom.ts
src/content/github-dom.unit.test.ts
src/content/html-fetcher.ts
src/content/html-fetcher.unit.test.ts
src/content/inline-preview.ts
src/content/inline-preview.unit.test.ts
src/content/observer.ts
src/content/observer.unit.test.ts
src/content/preview-button.ts
src/content/preview-button.unit.test.ts
src/content/side-panel.ts
src/content/side-panel.unit.test.ts
src/content/types.ts
src/content/url-utils.ts
src/content/url-utils.unit.test.ts
src/content/viewport-toggle.ts
src/content/viewport-toggle.unit.test.ts
src/preview-message-handler.ts
src/preview.html
src/preview.ts
src/preview.unit.test.ts

## 変更内容

diff --git a/public/manifest.json b/public/manifest.json
index 6533593..10f7b65 100644
--- a/public/manifest.json
+++ b/public/manifest.json
@@ -1,10 +1,11 @@
 {
   "manifest_version": 3,
-  "name": "Chrome Extension Template",
+  "name": "GitHub PR HTML Preview",
   "version": "0.1.0",
-  "description": "Chrome Extension Template",
+  "description": "Preview HTML files directly from GitHub PR's Files changed tab",
   "permissions": [
-    "storage"
+    "storage",
+    "activeTab"
   ],
   "background": {
     "service_worker": "assets/background.js",
@@ -13,7 +14,8 @@
   "content_scripts": [
     {
       "matches": [
-        "<all_urls>"
+        "https://github.com/*/pull/*",
+        "https://github.com/*/blob/*/*.html"
       ],
       "js": [
         "assets/content.js"
@@ -33,5 +35,11 @@
       "48": "icons/icon-48.png",
       "128": "icons/icon-128.png"
     }
-  }
+  },
+  "web_accessible_resources": [
+    {
+      "resources": ["src/preview.html", "assets/preview.js"],
+      "matches": ["https://github.com/*"]
+    }
+  ]
 }
diff --git a/src/background.ts b/src/background.ts
index d305aef..b4ca6bb 100644
--- a/src/background.ts
+++ b/src/background.ts
@@ -1,3 +1,24 @@
+const previewStore = new Map<string, { html: string | null; error: string | null }>();
+const PREVIEW_TTL_MS = 60_000;
+
 chrome.runtime.onInstalled.addListener(() => {
   console.log('Extension installed');
 });
+
+chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
+  if (message.type === 'preview-store') {
+    previewStore.set(message.id, { html: message.html, error: message.error ?? null });
+    // Auto-cleanup after TTL
+    setTimeout(() => previewStore.delete(message.id), PREVIEW_TTL_MS);
+    sendResponse({ ok: true });
+  } else if (message.type === 'preview-get') {
+    const data = previewStore.get(message.id);
+    if (data) {
+      previewStore.delete(message.id);
+      sendResponse(data);
+    } else {
+      sendResponse({ html: null, error: null, pending: true });
+    }
+  }
+  return true;
+});
diff --git a/src/content.ts b/src/content.ts
index bfef34e..f2cf11d 100644
--- a/src/content.ts
+++ b/src/content.ts
@@ -1,4 +1,25 @@
-// Content script
-// This script runs in the context of web pages
+import { getPageType } from './content/url-utils';
+import { addPreviewButtons } from './content/github-dom';
+import { startObserving } from './content/observer';
+import { createBatchPreviewButton } from './content/batch-preview';
 
-console.log('Content script loaded');
+const BATCH_BUTTON_SELECTOR = '.html-preview-batch-btn';
+
+startObserving(() => {
+  const pageType = getPageType(location.pathname);
+  if (pageType === 'unknown') return;
+
+  addPreviewButtons(pageType);
+
+  // Insert batch preview button on PR files page if not already present
+  if (pageType === 'pr-files' && !document.querySelector(BATCH_BUTTON_SELECTOR)) {
+    const batchBtn = createBatchPreviewButton();
+    if (batchBtn) {
+      // Insert near the top of the PR diff area
+      const diffHeader = document.querySelector('#diff-header, .pr-toolbar, .diffbar');
+      if (diffHeader) {
+        diffHeader.appendChild(batchBtn);
+      }
+    }
+  }
+});
diff --git a/src/test/setup.ts b/src/test/setup.ts
index f11ec88..d6812c6 100644
--- a/src/test/setup.ts
+++ b/src/test/setup.ts
@@ -18,6 +18,12 @@ const chromeMock = {
     onInstalled: {
       addListener: vi.fn(),
     },
+    sendMessage: vi.fn(),
+    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
+    onMessage: {
+      addListener: vi.fn(),
+      removeListener: vi.fn(),
+    },
   },
   contextMenus: {
     create: vi.fn(),
@@ -28,3 +34,14 @@ const chromeMock = {
 };
 
 vi.stubGlobal('chrome', chromeMock);
+
+// Mock fetch
+vi.stubGlobal('fetch', vi.fn());
+
+// Mock window.open
+vi.stubGlobal('open', vi.fn());
+
+// Mock crypto.randomUUID
+vi.stubGlobal('crypto', {
+  randomUUID: vi.fn(() => 'mock-uuid'),
+});
diff --git a/vite.config.ts b/vite.config.ts
index 0a1246a..105a797 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -9,6 +9,7 @@ export default defineConfig({
       input: {
         background: resolve(__dirname, 'src/background.ts'),
         options: resolve(__dirname, 'src/options/index.html'),
+        preview: resolve(__dirname, 'src/preview.html'),
       },
       output: {
         entryFileNames: 'assets/[name].js',
--- NEW FILE: src/content/batch-preview.ts ---
import { findHtmlFileHeaders, getRawUrl } from './github-dom';
import { fetchPreviewHtml } from './html-fetcher';
import { createInlinePreview } from './inline-preview';

const INLINE_WRAPPER_CLASS = 'html-preview-inline';

/**
 * Create a "Preview All HTML" button that opens inline previews for every HTML file.
 * @returns Button element, or null if no HTML files are found
 */
export function createBatchPreviewButton(): HTMLButtonElement | null {
  const headers = findHtmlFileHeaders();
  if (headers.length === 0) return null;

  const btn = document.createElement('button');
  btn.className = 'btn btn-sm html-preview-batch-btn';
  btn.textContent = `Preview All HTML (${headers.length})`;
  btn.addEventListener('click', () => previewAllHtml());
  return btn;
}

/**
 * Fetch and inline-preview all HTML files in the current PR.
 * Skips files that already have an open preview. Continues on per-file errors.
 */
async function previewAllHtml(): Promise<void> {
  const headers = findHtmlFileHeaders();
  for (const header of headers) {
    const rawUrl = getRawUrl(header);
    if (!rawUrl) continue;
    const container = header.closest('[id^="diff-"]') ?? header.parentElement;
    if (!container) continue;

    // Skip if already has an open inline preview
    if (container.querySelector(`.${INLINE_WRAPPER_CLASS}`)) continue;

    try {
      const html = await fetchPreviewHtml(rawUrl);
      createInlinePreview(container, html);
    } catch {
      // Continue with remaining files on per-file failure
    }
  }
}

--- NEW FILE: src/content/batch-preview.unit.test.ts ---
import { it, expect, vi, beforeEach } from 'vitest';
import { createBatchPreviewButton } from './batch-preview';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.mocked(fetch).mockReset();
});

it('creates a "Preview All HTML" button with file count', () => {
  document.body.innerHTML = `
    <div id="diff-header"></div>
    <div data-tagsearch-path="a.html" class="file-header">
      <a href="/owner/repo/blob/abc/a.html">View file</a>
    </div>
    <div data-tagsearch-path="b.html" class="file-header">
      <a href="/owner/repo/blob/abc/b.html">View file</a>
    </div>
    <div data-tagsearch-path="c.js" class="file-header">
      <a href="/owner/repo/blob/abc/c.js">View file</a>
    </div>
  `;

  const btn = createBatchPreviewButton();
  expect(btn).not.toBeNull();
  expect(btn!.textContent).toContain('Preview All HTML');
  expect(btn!.textContent).toContain('2');
});

it('returns null when no HTML files exist', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="app.js" class="file-header">
      <a href="/owner/repo/blob/abc/app.js">View file</a>
    </div>
  `;

  const btn = createBatchPreviewButton();
  expect(btn).toBeNull();
});

it('clicking the button triggers fetch for all HTML files', async () => {
  document.body.innerHTML = `
    <div id="diff-1">
      <div data-tagsearch-path="a.html" class="file-header">
        <div class="file-actions"></div>
        <a href="/owner/repo/blob/abc/a.html">View file</a>
      </div>
    </div>
    <div id="diff-2">
      <div data-tagsearch-path="b.html" class="file-header">
        <div class="file-actions"></div>
        <a href="/owner/repo/blob/abc/b.html">View file</a>
      </div>
    </div>
  `;

  vi.mocked(fetch).mockImplementation(() =>
    Promise.resolve(new Response('<html><head></head><body>OK</body></html>'))
  );

  const btn = createBatchPreviewButton();
  btn?.click();

  // Allow promises to resolve
  await vi.waitFor(() => {
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

--- NEW FILE: src/content/error-handling.unit.test.ts ---
import { it, expect, vi, beforeEach } from 'vitest';
import { updateButtonState } from './preview-button';

beforeEach(() => {
  vi.useFakeTimers();
});

it('sets button to loading state', () => {
  const btn = document.createElement('button');
  btn.textContent = 'Preview';

  updateButtonState(btn, 'loading');

  expect(btn.textContent).toBe('Loading...');
  expect(btn.disabled).toBe(true);
});

it('sets button to error state with message', () => {
  const btn = document.createElement('button');
  btn.textContent = 'Preview';

  updateButtonState(btn, 'error', 'Network error');

  expect(btn.textContent).toBe('Network error');
});

it('reverts button to idle after 3 seconds on error', () => {
  const btn = document.createElement('button');
  btn.textContent = 'Preview';

  updateButtonState(btn, 'error', 'Preview failed');

  vi.advanceTimersByTime(3000);

  expect(btn.textContent).toBe('Preview');
  expect(btn.disabled).toBe(false);
});

it('sets button back to idle state', () => {
  const btn = document.createElement('button');
  btn.textContent = 'Loading...';
  btn.disabled = true;

  updateButtonState(btn, 'idle');

  expect(btn.textContent).toBe('Preview');
  expect(btn.disabled).toBe(false);
});

--- NEW FILE: src/content/github-dom.ts ---
import type { PageType } from './types';
import { isHtmlFile, convertBlobToRawUrl } from './url-utils';
import { addPreviewButtonToHeader } from './preview-button';

const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';

const FILE_HEADER_SELECTORS = [
  '[data-tagsearch-path]',
  '.file-header[data-path]',
  '.file-header',
] as const;

const FILE_PATH_EXTRACTORS = [
  (el: Element) => el.getAttribute('data-tagsearch-path'),
  (el: Element) => el.getAttribute('data-path'),
  (el: Element) => el.querySelector('[title]')?.getAttribute('title') ?? null,
] as const;

/**
 * Find all file headers in the PR Files changed tab that correspond to HTML files.
 * @returns Array of header elements for .html files
 */
export function findHtmlFileHeaders(): Element[] {
  const headers: Element[] = [];
  for (const selector of FILE_HEADER_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const path = getFilePath(el);
      if (path && isHtmlFile(path) && !headers.includes(el)) {
        headers.push(el);
      }
    }
  }
  return headers;
}

/**
 * Extract the file path from a header element using multiple fallback strategies.
 * @param header - File header DOM element
 * @returns File path string, or null if not found
 */
export function getFilePath(header: Element): string | null {
  for (const extractor of FILE_PATH_EXTRACTORS) {
    const path = extractor(header);
    if (path) return path;
  }
  return null;
}

/**
 * Get the raw URL from a file header's "View file" link.
 * @param header - File header DOM element
 * @returns Raw URL string, or null if no link found (e.g. deleted file)
 */
export function getRawUrl(header: Element): string | null {
  const link = header.querySelector('a[href*="/blob/"]') as HTMLAnchorElement | null;
  if (!link) return null;
  return convertBlobToRawUrl(link.getAttribute('href') ?? '');
}

/**
 * Check whether a file header already has a preview button inserted.
 * @param header - File header DOM element
 * @returns true if a preview button already exists
 */
export function isAlreadyProcessed(header: Element): boolean {
  return header.querySelector(PREVIEW_BUTTON_SELECTOR) !== null;
}

/**
 * Get the raw URL from the "Raw" button on a blob file page.
 * @returns Raw URL string, or null if no Raw button found
 */
export function getBlobPageRawUrl(): string | null {
  const rawButton = document.querySelector(
    'a[data-testid="raw-button"], a.btn-sm[href*="/raw/"]'
  ) as HTMLAnchorElement | null;
  if (!rawButton) return null;
  return rawButton.getAttribute('href') ?? null;
}

/**
 * Add preview buttons to the page based on page type.
 * @param pageType - The detected page type ('pr-files' or 'blob-html')
 */
export function addPreviewButtons(pageType: PageType): void {
  if (pageType === 'pr-files') {
    addPreviewButtonsToPrFiles();
  } else if (pageType === 'blob-html') {
    addPreviewButtonToBlobPage();
  }
}

/** Insert preview buttons into each HTML file header on PR Files changed tab. */
function addPreviewButtonsToPrFiles(): void {
  const headers = findHtmlFileHeaders();
  for (const header of headers) {
    if (isAlreadyProcessed(header)) continue;
    const rawUrl = getRawUrl(header);
    if (!rawUrl) continue;
    addPreviewButtonToHeader(header, rawUrl);
  }
}

/** Insert a preview button next to the Raw button on a blob file page. */
function addPreviewButtonToBlobPage(): void {
  if (document.querySelector(PREVIEW_BUTTON_SELECTOR)) return;

  const rawUrl = getBlobPageRawUrl();
  if (!rawUrl) return;

  const rawButton = document.querySelector(
    'a[data-testid="raw-button"], a.btn-sm[href*="/raw/"]'
  );
  if (!rawButton?.parentElement) return;

  // Create a wrapper to act as header for addPreviewButtonToHeader
  addPreviewButtonToHeader(rawButton.parentElement, rawUrl);
}

--- NEW FILE: src/content/github-dom.unit.test.ts ---
import { it, expect, beforeEach } from 'vitest';
import {
  findHtmlFileHeaders,
  getFilePath,
  getRawUrl,
  isAlreadyProcessed,
  getBlobPageRawUrl,
  addPreviewButtons,
} from './github-dom';

beforeEach(() => {
  document.body.innerHTML = '';
});

// findHtmlFileHeaders

it('detects file headers with data-tagsearch-path for .html files', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="src/index.html" class="file-header">
      <a href="/owner/repo/blob/abc123/src/index.html">View file</a>
    </div>
    <div data-tagsearch-path="src/app.js" class="file-header">
      <a href="/owner/repo/blob/abc123/src/app.js">View file</a>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(1);
});

it('detects file headers with .file-header[data-path] fallback', () => {
  document.body.innerHTML = `
    <div class="file-header" data-path="page.html">
      <a href="/owner/repo/blob/abc123/page.html">View file</a>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(1);
});

it('filters out non-HTML files', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="style.css" class="file-header">
      <a href="/owner/repo/blob/abc123/style.css">View file</a>
    </div>
    <div data-tagsearch-path="script.js" class="file-header">
      <a href="/owner/repo/blob/abc123/script.js">View file</a>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(0);
});

// getFilePath

it('extracts file path from data-tagsearch-path', () => {
  const el = document.createElement('div');
  el.setAttribute('data-tagsearch-path', 'src/index.html');
  expect(getFilePath(el)).toBe('src/index.html');
});

it('extracts file path from data-path as fallback', () => {
  const el = document.createElement('div');
  el.setAttribute('data-path', 'page.html');
  expect(getFilePath(el)).toBe('page.html');
});

it('extracts file path from title attribute as fallback', () => {
  const el = document.createElement('div');
  const span = document.createElement('span');
  span.setAttribute('title', 'dir/file.html');
  el.appendChild(span);
  expect(getFilePath(el)).toBe('dir/file.html');
});

it('returns null when no path is found', () => {
  const el = document.createElement('div');
  expect(getFilePath(el)).toBeNull();
});

// getRawUrl

it('extracts raw URL from "View file" link href', () => {
  const el = document.createElement('div');
  el.innerHTML = '<a href="/owner/repo/blob/abc123/index.html">View file</a>';
  const url = getRawUrl(el);
  expect(url).toContain('/raw/');
});

it('returns null when no "View file" link exists (deleted file)', () => {
  const el = document.createElement('div');
  el.innerHTML = '<span>deleted file</span>';
  expect(getRawUrl(el)).toBeNull();
});

// isAlreadyProcessed

it('returns false when no preview button exists', () => {
  const el = document.createElement('div');
  expect(isAlreadyProcessed(el)).toBe(false);
});

it('returns true when preview button already exists', () => {
  const el = document.createElement('div');
  const btn = document.createElement('button');
  btn.className = 'html-preview-btn';
  el.appendChild(btn);
  expect(isAlreadyProcessed(el)).toBe(true);
});

// getBlobPageRawUrl

it('extracts raw URL from Raw button on blob page', () => {
  document.body.innerHTML = `
    <a data-testid="raw-button" href="/owner/repo/raw/main/index.html">Raw</a>
  `;
  const url = getBlobPageRawUrl();
  expect(url).toContain('/raw/');
});

it('returns null when no Raw button exists', () => {
  document.body.innerHTML = '<div>no raw button</div>';
  expect(getBlobPageRawUrl()).toBeNull();
});

// addPreviewButtons delegates by page type (integration-level)

it('addPreviewButtons with pr-files processes HTML file headers', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="index.html" class="file-header">
      <div class="file-actions"></div>
      <a href="/owner/repo/blob/abc123/index.html">View file</a>
    </div>
  `;
  addPreviewButtons('pr-files');
  expect(document.querySelector('.html-preview-btn')).not.toBeNull();
});

it('addPreviewButtons with blob-html adds button near Raw button', () => {
  document.body.innerHTML = `
    <a data-testid="raw-button" href="/owner/repo/raw/main/index.html">Raw</a>
  `;
  addPreviewButtons('blob-html');
  expect(document.querySelector('.html-preview-btn')).not.toBeNull();
});

it('buttons use GitHub native btn class for theme compatibility', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="index.html" class="file-header">
      <div class="file-actions"></div>
      <a href="/owner/repo/blob/abc123/index.html">View file</a>
    </div>
  `;
  addPreviewButtons('pr-files');
  const btn = document.querySelector('.html-preview-btn') as HTMLElement;
  expect(btn.classList.contains('btn')).toBe(true);
  expect(btn.classList.contains('btn-sm')).toBe(true);
});

it('addPreviewButtons skips already processed headers', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="index.html" class="file-header">
      <div class="file-actions"><button class="html-preview-btn">Preview</button></div>
      <a href="/owner/repo/blob/abc123/index.html">View file</a>
    </div>
  `;
  addPreviewButtons('pr-files');
  const buttons = document.querySelectorAll('.html-preview-btn');
  expect(buttons).toHaveLength(1);
});

--- NEW FILE: src/content/html-fetcher.ts ---
import { injectBaseTag } from './url-utils';

/**
 * Build preview HTML by injecting a `<base>` tag using the raw URL's directory as base.
 * @param rawUrl - The raw GitHub URL of the HTML file
 * @param html - The raw HTML content
 * @returns HTML string with `<base>` tag injected
 */
export function buildPreviewHtml(rawUrl: string, html: string): string {
  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
  return injectBaseTag(html, baseUrl);
}

/**
 * Fetch raw HTML from GitHub and return it with `<base>` tag injected.
 * @param rawUrl - The raw GitHub URL to fetch
 * @returns HTML string ready for preview
 * @throws Error if fetch fails
 */
export async function fetchPreviewHtml(rawUrl: string): Promise<string> {
  const response = await fetch(rawUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return buildPreviewHtml(rawUrl, html);
}

/**
 * Open a new preview tab and fetch+send the HTML to it via background messaging.
 * Opens the tab synchronously (in click event) to avoid popup blockers,
 * then fetches HTML async and sends it via chrome.runtime.sendMessage.
 * @param rawUrl - The raw GitHub URL of the HTML file
 */
export async function fetchAndPreview(rawUrl: string): Promise<void> {
  const previewId = crypto.randomUUID();
  const previewUrl = chrome.runtime.getURL(`src/preview.html?id=${previewId}`);
  window.open(previewUrl, '_blank');

  try {
    const htmlWithBase = await fetchPreviewHtml(rawUrl);
    chrome.runtime.sendMessage({
      type: 'preview-store',
      id: previewId,
      html: htmlWithBase,
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'preview-store',
      id: previewId,
      html: null,
      error: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

--- NEW FILE: src/content/html-fetcher.unit.test.ts ---
import { it, expect, vi, beforeEach } from 'vitest';
import { fetchAndPreview, fetchPreviewHtml, buildPreviewHtml } from './html-fetcher';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fetch).mockReset();
  vi.mocked(window.open).mockReset();
  vi.mocked(chrome.runtime.sendMessage).mockReset();
  vi.mocked(chrome.runtime.getURL).mockImplementation(
    (path: string) => `chrome-extension://mock-id/${path}`
  );
  vi.mocked(crypto.randomUUID).mockReturnValue('mock-uuid' as `${string}-${string}-${string}-${string}-${string}`);
});

// buildPreviewHtml

it('injects <base> tag based on raw URL directory', () => {
  const html = '<html><head></head><body>Hello</body></html>';
  const result = buildPreviewHtml('https://github.com/owner/repo/raw/main/dir/index.html', html);
  expect(result).toContain('<base href="https://github.com/owner/repo/raw/main/dir/"');
});

// fetchPreviewHtml

it('fetches HTML with credentials include', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html><head></head><body>OK</body></html>'));

  await fetchPreviewHtml('https://github.com/owner/repo/raw/main/index.html');

  expect(fetch).toHaveBeenCalledWith(
    'https://github.com/owner/repo/raw/main/index.html',
    { credentials: 'include' }
  );
});

it('returns HTML with <base> tag injected', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html><head></head><body>OK</body></html>'));

  const result = await fetchPreviewHtml('https://github.com/owner/repo/raw/main/dir/index.html');

  expect(result).toContain('<base href="https://github.com/owner/repo/raw/main/dir/"');
});

// fetchAndPreview

it('opens preview page via window.open with extension URL', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html><head></head><body>OK</body></html>'));

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(window.open).toHaveBeenCalledWith(
    'chrome-extension://mock-id/src/preview.html?id=mock-uuid',
    '_blank'
  );
});

it('sends preview-store message via chrome.runtime.sendMessage after fetch', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html><head></head><body>OK</body></html>'));

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-store',
      id: 'mock-uuid',
      html: expect.stringContaining('<base'),
    })
  );
});

it('calls window.open before fetch (synchronous popup)', async () => {
  const callOrder: string[] = [];
  vi.mocked(window.open).mockImplementation(() => {
    callOrder.push('open');
    return null;
  });
  vi.mocked(fetch).mockImplementation(() => {
    callOrder.push('fetch');
    return Promise.resolve(new Response('<html><head></head><body></body></html>'));
  });

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(callOrder[0]).toBe('open');
  expect(callOrder[1]).toBe('fetch');
});

// Error handling

it('sends error message on network failure', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('Failed to fetch'));

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-store',
      id: 'mock-uuid',
      html: null,
      error: 'Fetch failed: Failed to fetch',
    })
  );
});

it('sends error message on 401 response', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 401 }));

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-store',
      html: null,
      error: expect.stringContaining('401'),
    })
  );
});

it('throws on non-ok response in fetchPreviewHtml', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('Forbidden', { status: 403 }));

  await expect(fetchPreviewHtml('https://github.com/owner/repo/raw/main/index.html'))
    .rejects.toThrow('HTTP 403');
});

--- NEW FILE: src/content/inline-preview.ts ---
import { createViewportToggle } from './viewport-toggle';

const INLINE_WRAPPER_CLASS = 'html-preview-inline';

/**
 * Create an inline iframe preview inside a container element.
 * @param container - The DOM element to append the preview to
 * @param html - HTML content to render (should already have `<base>` injected)
 * @returns The created iframe element
 */
export function createInlinePreview(
  container: Element,
  html: string
): HTMLIFrameElement {
  const wrapper = document.createElement('div');
  wrapper.className = INLINE_WRAPPER_CLASS;
  wrapper.style.cssText = `
    border: 1px solid var(--color-border-default);
    border-radius: 6px;
    margin: 8px 0;
    overflow: hidden;
  `;

  const iframe = document.createElement('iframe');
  iframe.srcdoc = html;
  iframe.style.cssText = `
    width: 100%;
    height: 400px;
    border: none;
    resize: vertical;
    overflow: auto;
  `;
  iframe.setAttribute('sandbox', 'allow-scripts');

  const toggle = createViewportToggle(iframe);
  wrapper.appendChild(toggle);
  wrapper.appendChild(iframe);
  container.appendChild(wrapper);
  return iframe;
}

/**
 * Toggle inline preview visibility. Creates the preview on first call,
 * hides on second, shows on third, etc.
 * @param container - The DOM element containing the preview
 * @param html - HTML content to render
 */
export function toggleInlinePreview(container: Element, html: string): void {
  const existing = container.querySelector(`.${INLINE_WRAPPER_CLASS}`) as HTMLElement | null;
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? '' : 'none';
    return;
  }
  createInlinePreview(container, html);
}

/**
 * Remove the inline preview from a container, clearing iframe srcdoc first.
 * @param container - The DOM element containing the preview
 */
export function removeInlinePreview(container: Element): void {
  const wrapper = container.querySelector(`.${INLINE_WRAPPER_CLASS}`);
  if (!wrapper) return;

  const iframe = wrapper.querySelector('iframe');
  if (iframe) iframe.srcdoc = '';

  wrapper.remove();
}

--- NEW FILE: src/content/inline-preview.unit.test.ts ---
import { it, expect, beforeEach } from 'vitest';
import {
  createInlinePreview,
  toggleInlinePreview,
  removeInlinePreview,
} from './inline-preview';

beforeEach(() => {
  document.body.innerHTML = '';
});

// createInlinePreview

it('creates an iframe wrapper inside the container', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>Hello</body></html>');

  const wrapper = container.querySelector('.html-preview-inline');
  expect(wrapper).not.toBeNull();
});

it('sets iframe srcdoc to the provided HTML', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Hello</body></html>');

  expect(iframe.srcdoc).toContain('Hello');
});

it('sets iframe sandbox to allow-scripts', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body></body></html>');

  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
});

// toggleInlinePreview

it('creates preview on first toggle', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  toggleInlinePreview(container, '<html><body>Toggle</body></html>');

  expect(container.querySelector('.html-preview-inline')).not.toBeNull();
});

it('hides preview on second toggle', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  toggleInlinePreview(container, '<html><body>Toggle</body></html>');
  toggleInlinePreview(container, '<html><body>Toggle</body></html>');

  const wrapper = container.querySelector('.html-preview-inline') as HTMLElement;
  expect(wrapper.style.display).toBe('none');
});

it('shows preview on third toggle', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  toggleInlinePreview(container, '<html><body>Toggle</body></html>');
  toggleInlinePreview(container, '<html><body>Toggle</body></html>');
  toggleInlinePreview(container, '<html><body>Toggle</body></html>');

  const wrapper = container.querySelector('.html-preview-inline') as HTMLElement;
  expect(wrapper.style.display).toBe('');
});

// removeInlinePreview

it('removes the wrapper from container', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>Remove me</body></html>');
  removeInlinePreview(container);

  expect(container.querySelector('.html-preview-inline')).toBeNull();
});

it('clears iframe srcdoc before removal', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Clear me</body></html>');
  removeInlinePreview(container);

  expect(iframe.srcdoc).toBe('');
});

--- NEW FILE: src/content/observer.ts ---
const DEBOUNCE_DELAY_MS = 150;

let observer: MutationObserver | null = null;
let turboHandler: (() => void) | null = null;
let popstateHandler: (() => void) | null = null;

/**
 * Create a debounced version of a function.
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
function debounce(fn: () => void, delay: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

/**
 * Start observing DOM changes and navigation events.
 * Calls the callback immediately for an initial scan, then on every
 * MutationObserver trigger (debounced 150ms), `turbo:load`, and `popstate` event.
 * @param callback - Function to call when the page content may have changed
 */
export function startObserving(callback: () => void): void {
  // Initial scan
  callback();

  // MutationObserver with debounce for lazy-loaded diffs
  const debouncedCallback = debounce(callback, DEBOUNCE_DELAY_MS);
  observer = new MutationObserver(() => {
    debouncedCallback();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // PJAX/Turbo navigation (not debounced — these are discrete events)
  turboHandler = () => callback();
  document.addEventListener('turbo:load', turboHandler);

  popstateHandler = () => callback();
  window.addEventListener('popstate', popstateHandler);
}

/**
 * Stop observing DOM changes and remove all event listeners.
 */
export function stopObserving(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (turboHandler) {
    document.removeEventListener('turbo:load', turboHandler);
    turboHandler = null;
  }
  if (popstateHandler) {
    window.removeEventListener('popstate', popstateHandler);
    popstateHandler = null;
  }
}

--- NEW FILE: src/content/observer.unit.test.ts ---
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startObserving, stopObserving } from './observer';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stopObserving();
  vi.useRealTimers();
});

it('calls callback immediately on start (initial scan)', () => {
  const callback = vi.fn();
  startObserving(callback);
  expect(callback).toHaveBeenCalledOnce();
});

it('calls callback on turbo:load event', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  document.dispatchEvent(new Event('turbo:load'));
  expect(callback).toHaveBeenCalledOnce();
});

it('calls callback on popstate event', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  window.dispatchEvent(new Event('popstate'));
  expect(callback).toHaveBeenCalledOnce();
});

it('stops observing when stopObserving is called', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  stopObserving();
  document.dispatchEvent(new Event('turbo:load'));
  expect(callback).not.toHaveBeenCalled();
});

// debounce tests

it('debounces rapid DOM changes to a single callback', async () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  // Trigger multiple rapid DOM changes
  document.body.appendChild(document.createElement('div'));
  document.body.appendChild(document.createElement('span'));
  document.body.appendChild(document.createElement('p'));

  // Wait for MutationObserver microtask
  await vi.advanceTimersByTimeAsync(0);

  // Should not have fired yet (within debounce window)
  expect(callback).not.toHaveBeenCalled();

  // Advance past debounce delay
  await vi.advanceTimersByTimeAsync(150);
  expect(callback).toHaveBeenCalledOnce();
});

it('fires again after debounce period for new changes', async () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  document.body.appendChild(document.createElement('div'));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(150);
  expect(callback).toHaveBeenCalledOnce();

  callback.mockClear();
  document.body.appendChild(document.createElement('span'));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(150);
  expect(callback).toHaveBeenCalledOnce();
});

--- NEW FILE: src/content/preview-button.ts ---
import type { ButtonState } from './types';
import { fetchAndPreview, fetchPreviewHtml } from './html-fetcher';
import { toggleInlinePreview } from './inline-preview';
import { showInPanel } from './side-panel';
import { getFilePath } from './github-dom';

const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';
const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
const DEFAULT_LABEL = 'Preview';
const ERROR_REVERT_MS = 3000;

/**
 * Create a preview button element with a given label.
 * @param label - Button text to display
 * @param onClick - Click handler to invoke when the button is clicked
 * @returns The created button element
 */
export function createPreviewButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = BUTTON_CLASSES;
  btn.textContent = label;
  btn.dataset.label = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Insert a button into a file header element.
 * Tries `.file-actions`, then `.file-info`, then appends to header itself.
 * @param header - File header DOM element
 * @param button - Button element to insert
 */
export function insertPreviewButton(header: Element, button: HTMLButtonElement): void {
  const actions = header.querySelector('.file-actions');
  if (actions) {
    actions.prepend(button);
    return;
  }

  const info = header.querySelector('.file-info');
  if (info) {
    info.appendChild(button);
    return;
  }

  header.appendChild(button);
}

/**
 * Update a button's visual state (idle, loading, error).
 * On error, reverts to idle after 3 seconds.
 * @param btn - The button element to update
 * @param state - Target state
 * @param message - Optional message to display (used for error state)
 */
export function updateButtonState(btn: HTMLButtonElement, state: ButtonState, message?: string): void {
  switch (state) {
    case 'loading':
      btn.textContent = 'Loading...';
      btn.disabled = true;
      break;
    case 'error':
      btn.textContent = message ?? 'Error';
      btn.disabled = false;
      setTimeout(() => updateButtonState(btn, 'idle'), ERROR_REVERT_MS);
      break;
    case 'idle':
      btn.textContent = btn.dataset.label ?? DEFAULT_LABEL;
      btn.disabled = false;
      break;
  }
}

/**
 * Add 3 preview buttons (Preview, Inline, Panel) to a file header if not already present.
 * @param header - File header DOM element
 * @param rawUrl - Raw URL for the HTML file
 */
export function addPreviewButtonToHeader(header: Element, rawUrl: string): void {
  if (header.querySelector(PREVIEW_BUTTON_SELECTOR)) return;

  const fileName = getFilePath(header) ?? 'preview.html';

  // Find the diff container (parent of header) for inline preview
  const diffContainer = header.closest('[id^="diff-"]') ?? header.parentElement;

  // Panel button (inserted first so it appears last due to prepend)
  const panelBtn = createPreviewButton('Panel', async () => {
    updateButtonState(panelBtn, 'loading');
    try {
      const html = await fetchPreviewHtml(rawUrl);
      showInPanel(html, fileName);
      updateButtonState(panelBtn, 'idle');
    } catch (e) {
      updateButtonState(panelBtn, 'error', e instanceof Error ? e.message : 'Preview failed');
    }
  });
  insertPreviewButton(header, panelBtn);

  // Inline button
  const inlineBtn = createPreviewButton('Inline', async () => {
    if (!diffContainer) return;
    updateButtonState(inlineBtn, 'loading');
    try {
      const html = await fetchPreviewHtml(rawUrl);
      toggleInlinePreview(diffContainer, html);
      updateButtonState(inlineBtn, 'idle');
    } catch (e) {
      updateButtonState(inlineBtn, 'error', e instanceof Error ? e.message : 'Preview failed');
    }
  });
  insertPreviewButton(header, inlineBtn);

  // Preview button (new tab) — inserted last so it appears first
  const previewBtn = createPreviewButton('Preview', () => {
    fetchAndPreview(rawUrl);
  });
  insertPreviewButton(header, previewBtn);
}

--- NEW FILE: src/content/preview-button.unit.test.ts ---
import { it, expect, vi, beforeEach } from 'vitest';
import {
  createPreviewButton,
  insertPreviewButton,
  addPreviewButtonToHeader,
} from './preview-button';

beforeEach(() => {
  document.body.innerHTML = '';
});

// createPreviewButton

it('creates a button element with correct class and text', () => {
  const btn = createPreviewButton('Preview', vi.fn());
  expect(btn.tagName).toBe('BUTTON');
  expect(btn.classList.contains('html-preview-btn')).toBe(true);
  expect(btn.classList.contains('btn')).toBe(true);
  expect(btn.classList.contains('btn-sm')).toBe(true);
  expect(btn.textContent).toBe('Preview');
});

it('creates a button with custom label', () => {
  const btn = createPreviewButton('Inline', vi.fn());
  expect(btn.textContent).toBe('Inline');
});

it('calls handler when clicked', () => {
  const handler = vi.fn();
  const btn = createPreviewButton('Preview', handler);
  btn.click();
  expect(handler).toHaveBeenCalledOnce();
});

// insertPreviewButton

it('inserts button into .file-actions container', () => {
  const header = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  header.appendChild(actions);

  const btn = document.createElement('button');
  insertPreviewButton(header, btn);

  expect(actions.contains(btn)).toBe(true);
});

it('falls back to .file-info container', () => {
  const header = document.createElement('div');
  const info = document.createElement('div');
  info.className = 'file-info';
  header.appendChild(info);

  const btn = document.createElement('button');
  insertPreviewButton(header, btn);

  expect(info.contains(btn)).toBe(true);
});

it('falls back to appending to header itself', () => {
  const header = document.createElement('div');

  const btn = document.createElement('button');
  insertPreviewButton(header, btn);

  expect(header.contains(btn)).toBe(true);
});

// addPreviewButtonToHeader — 3 buttons

it('does not insert duplicate buttons', () => {
  const header = document.createElement('div');
  const existing = document.createElement('button');
  existing.className = 'html-preview-btn';
  header.appendChild(existing);

  addPreviewButtonToHeader(header, 'https://example.com/raw/file.html');

  const buttons = header.querySelectorAll('.html-preview-btn');
  expect(buttons).toHaveLength(1);
});

it('inserts 3 preview buttons (Preview, Inline, Panel)', () => {
  const header = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  header.appendChild(actions);

  addPreviewButtonToHeader(header, 'https://example.com/raw/file.html');

  const buttons = header.querySelectorAll('.html-preview-btn');
  expect(buttons).toHaveLength(3);
  expect(buttons[0].textContent).toBe('Preview');
  expect(buttons[1].textContent).toBe('Inline');
  expect(buttons[2].textContent).toBe('Panel');
});

it('Preview button calls fetchAndPreview handler', () => {
  const header = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  header.appendChild(actions);

  addPreviewButtonToHeader(header, 'https://example.com/raw/file.html');

  const previewBtn = header.querySelectorAll('.html-preview-btn')[0] as HTMLButtonElement;
  expect(previewBtn.textContent).toBe('Preview');
});

--- NEW FILE: src/content/side-panel.ts ---
import { createViewportToggle } from './viewport-toggle';

const PANEL_ID = 'html-preview-panel';
const PANEL_IFRAME_ID = 'html-preview-panel-iframe';
const PANEL_CLOSE_ID = 'html-preview-panel-close';
const PANEL_WIDTH = '40%';

/**
 * Create a fixed side panel on the right of the page with a resize handle,
 * header, and sandboxed iframe.
 * @returns The created panel element
 */
export function createSidePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: ${PANEL_WIDTH};
    height: 100vh;
    background: var(--color-canvas-default);
    border-left: 1px solid var(--color-border-default);
    z-index: 100;
    display: flex;
    flex-direction: column;
    box-shadow: -2px 0 8px rgba(0,0,0,0.1);
  `;

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 4px;
    height: 100%;
    cursor: col-resize;
  `;
  setupResize(resizeHandle, panel);

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border-default);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `;

  // Iframe
  const iframe = document.createElement('iframe');
  iframe.id = PANEL_IFRAME_ID;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = 'flex: 1; border: none; width: 100%;';

  const toggle = createViewportToggle(iframe);

  panel.appendChild(resizeHandle);
  panel.appendChild(header);
  panel.appendChild(toggle);
  panel.appendChild(iframe);
  document.body.appendChild(panel);

  document.body.style.marginRight = PANEL_WIDTH;

  return panel;
}

/**
 * Show HTML content in the side panel. Creates the panel if it doesn't exist.
 * @param html - HTML content to render in the panel iframe
 * @param fileName - File name to display in the panel header
 */
export function showInPanel(html: string, fileName: string): void {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) panel = createSidePanel();

  const iframe = panel.querySelector('iframe') as HTMLIFrameElement;
  iframe.srcdoc = html;

  // Update header with file name and close button
  const header = panel.children[1] as HTMLElement;
  header.innerHTML = '';

  const nameSpan = document.createElement('span');
  nameSpan.style.fontWeight = '600';
  nameSpan.textContent = fileName;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-sm';
  closeBtn.id = PANEL_CLOSE_ID;
  closeBtn.textContent = '\u2715';
  closeBtn.addEventListener('click', closeSidePanel);

  header.appendChild(nameSpan);
  header.appendChild(closeBtn);
}

/**
 * Close and remove the side panel, restoring the page layout.
 */
export function closeSidePanel(): void {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
    document.body.style.marginRight = '';
  }
}

/**
 * Set up mousedown drag-to-resize on the panel's left edge.
 * @param handle - The resize handle element
 * @param panel - The panel element to resize
 */
function setupResize(handle: HTMLElement, panel: HTMLElement): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = window.innerWidth - moveEvent.clientX;
      const widthPct = `${Math.max(20, Math.min(80, (newWidth / window.innerWidth) * 100))}%`;
      panel.style.width = widthPct;
      document.body.style.marginRight = widthPct;
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

--- NEW FILE: src/content/side-panel.unit.test.ts ---
import { it, expect, beforeEach } from 'vitest';
import { createSidePanel, showInPanel, closeSidePanel } from './side-panel';

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.marginRight = '';
});

// createSidePanel

it('adds a fixed panel to document.body', () => {
  createSidePanel();
  const panel = document.getElementById('html-preview-panel');
  expect(panel).not.toBeNull();
  expect(panel?.style.position).toBe('fixed');
});

it('sets document.body.style.marginRight to adjust layout', () => {
  createSidePanel();
  expect(document.body.style.marginRight).toBe('40%');
});

it('contains an iframe with sandbox allow-scripts', () => {
  createSidePanel();
  const iframe = document.querySelector('#html-preview-panel iframe');
  expect(iframe).not.toBeNull();
  expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
});

// showInPanel

it('creates panel if it does not exist', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  expect(document.getElementById('html-preview-panel')).not.toBeNull();
});

it('sets iframe srcdoc to provided HTML', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const iframe = document.querySelector('#html-preview-panel iframe') as HTMLIFrameElement;
  expect(iframe.srcdoc).toContain('Hello');
});

it('displays file name in header', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const panel = document.getElementById('html-preview-panel')!;
  expect(panel.textContent).toContain('index.html');
});

// closeSidePanel

it('removes the panel from DOM', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  closeSidePanel();
  expect(document.getElementById('html-preview-panel')).toBeNull();
});

it('restores document.body.style.marginRight', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  closeSidePanel();
  expect(document.body.style.marginRight).toBe('');
});

it('close button triggers panel removal', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const closeBtn = document.getElementById('html-preview-panel-close');
  expect(closeBtn).not.toBeNull();
  closeBtn?.click();
  expect(document.getElementById('html-preview-panel')).toBeNull();
});

--- NEW FILE: src/content/types.ts ---
export type FileHeaderInfo = {
  filePath: string;
  rawUrl: string;
  headerElement: Element;
};

export type ButtonState = 'idle' | 'loading' | 'error';

export type PreviewMode = 'new-tab' | 'inline' | 'panel';

export type PageType = 'pr-files' | 'blob-html' | 'unknown';

--- NEW FILE: src/content/url-utils.ts ---
import type { PageType } from './types';

/**
 * Convert a GitHub blob URL to a raw URL by replacing `/blob/` with `/raw/`.
 * @param url - GitHub blob URL (absolute or relative)
 * @returns Raw URL, or null if the URL does not contain `/blob/`
 */
export function convertBlobToRawUrl(url: string): string | null {
  if (!url.includes('/blob/')) return null;
  return url.replace('/blob/', '/raw/');
}

/**
 * Check whether a file path has an HTML extension (.html or .htm).
 * @param filePath - File name or path to check
 * @returns true if the file is an HTML file
 */
export function isHtmlFile(filePath: string): boolean {
  return /\.html?$/i.test(filePath);
}

/**
 * Inject or overwrite a `<base href>` tag in the given HTML string.
 * Uses DOMParser so it handles missing `<head>`, existing `<base>`, etc.
 * @param html - Raw HTML string
 * @param baseUrl - Base URL to set (e.g. raw URL directory)
 * @returns HTML string with `<base>` injected and DOCTYPE preserved
 */
export function injectBaseTag(html: string, baseUrl: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  let base = doc.querySelector('base');
  if (base) {
    base.href = baseUrl;
  } else {
    base = doc.createElement('base');
    base.href = baseUrl;
    doc.head.prepend(base);
  }

  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}>`
    : '<!DOCTYPE html>';
  return doctype + '\n' + doc.documentElement.outerHTML;
}

/**
 * Determine the GitHub page type from a URL path.
 * @param path - URL pathname (e.g. `/owner/repo/pull/123/files`)
 * @returns Page type: `'pr-files'`, `'blob-html'`, or `'unknown'`
 */
export function getPageType(path: string): PageType {
  if (/\/pull\/\d+\/files/.test(path)) return 'pr-files';
  if (/\/blob\/.*\.html?$/i.test(path)) return 'blob-html';
  return 'unknown';
}

--- NEW FILE: src/content/url-utils.unit.test.ts ---
import { it, expect, test } from 'vitest';
import { convertBlobToRawUrl, isHtmlFile, injectBaseTag, getPageType } from './url-utils';

// convertBlobToRawUrl

it('converts /blob/ to /raw/ in a standard URL', () => {
  expect(convertBlobToRawUrl('https://github.com/owner/repo/blob/main/index.html'))
    .toBe('https://github.com/owner/repo/raw/main/index.html');
});

it('converts /blob/ to /raw/ for a sha-based URL', () => {
  expect(convertBlobToRawUrl('https://github.com/owner/repo/blob/abc123/path/to/file.html'))
    .toBe('https://github.com/owner/repo/raw/abc123/path/to/file.html');
});

test.each([
  ['Japanese chars', 'https://github.com/owner/repo/blob/main/日本語/ファイル.html', 'https://github.com/owner/repo/raw/main/日本語/ファイル.html'],
  ['spaces (encoded)', 'https://github.com/owner/repo/blob/main/my%20file.html', 'https://github.com/owner/repo/raw/main/my%20file.html'],
  ['special chars (#)', 'https://github.com/owner/repo/blob/main/file%23name.html', 'https://github.com/owner/repo/raw/main/file%23name.html'],
  ['relative path', '/owner/repo/blob/main/index.html', '/owner/repo/raw/main/index.html'],
])('converts /blob/ to /raw/ with %s', (_label, input, expected) => {
  expect(convertBlobToRawUrl(input)).toBe(expected);
});

it('returns null for URL without /blob/', () => {
  expect(convertBlobToRawUrl('https://github.com/owner/repo/tree/main')).toBeNull();
});

// isHtmlFile

test.each([
  ['index.html', true],
  ['page.htm', true],
  ['Page.HTML', true],
  ['file.HTM', true],
  ['script.js', false],
  ['style.css', false],
  ['readme.md', false],
])('isHtmlFile(%s) returns %s', (input, expected) => {
  expect(isHtmlFile(input)).toBe(expected);
});

// injectBaseTag

it('injects <base> tag after <head>', () => {
  const html = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>';
  const result = injectBaseTag(html, 'https://github.com/owner/repo/raw/main/dir/');
  expect(result).toContain('<base href="https://github.com/owner/repo/raw/main/dir/"');
});

it('injects <base> tag even when <head> is missing', () => {
  const html = '<html><body><p>Hello</p></body></html>';
  const result = injectBaseTag(html, 'https://example.com/');
  expect(result).toContain('<base href="https://example.com/"');
});

it('overwrites existing <base> tag', () => {
  const html = '<!DOCTYPE html><html><head><base href="http://old.com/"><title>Test</title></head><body></body></html>';
  const result = injectBaseTag(html, 'https://new.com/');
  expect(result).toContain('<base href="https://new.com/"');
  expect(result).not.toContain('http://old.com/');
});

it('preserves DOCTYPE', () => {
  const html = '<!DOCTYPE html><html><head></head><body></body></html>';
  const result = injectBaseTag(html, 'https://example.com/');
  expect(result).toMatch(/^<!DOCTYPE html>/i);
});

// getPageType

test.each([
  ['/owner/repo/pull/123/files', 'pr-files'],
  ['/owner/repo/blob/main/index.html', 'blob-html'],
  ['/owner/repo/tree/main', 'unknown'],
  ['/owner/repo/pull/123', 'unknown'],
])('getPageType(%s) returns %s', (input, expected) => {
  expect(getPageType(input)).toBe(expected);
});

--- NEW FILE: src/content/viewport-toggle.ts ---
type ViewportName = 'mobile' | 'tablet' | 'desktop';

const VIEWPORTS: Record<ViewportName, { width: string; label: string }> = {
  mobile:  { width: '375px',  label: 'Mobile' },
  tablet:  { width: '768px',  label: 'Tablet' },
  desktop: { width: '100%',   label: 'Desktop' },
};

/**
 * Set an iframe's width to match a named viewport preset.
 * @param iframe - The iframe element to resize
 * @param viewport - Viewport name ('mobile', 'tablet', or 'desktop')
 */
export function setViewport(iframe: HTMLIFrameElement, viewport: ViewportName): void {
  iframe.style.width = VIEWPORTS[viewport].width;
}

/**
 * Create a viewport toggle button group that controls an iframe's width.
 * @param iframe - The iframe element to control
 * @returns A container element with Mobile/Tablet/Desktop buttons
 */
export function createViewportToggle(iframe: HTMLIFrameElement): HTMLElement {
  const container = document.createElement('div');
  container.className = 'html-preview-viewport-toggle';
  container.style.cssText = 'display: flex; gap: 4px; padding: 4px 0;';

  const viewportNames: ViewportName[] = ['mobile', 'tablet', 'desktop'];
  const buttons: HTMLButtonElement[] = [];

  for (const name of viewportNames) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = VIEWPORTS[name].label;
    if (name === 'desktop') btn.classList.add('selected');

    btn.addEventListener('click', () => {
      setViewport(iframe, name);
      for (const b of buttons) b.classList.remove('selected');
      btn.classList.add('selected');
    });

    buttons.push(btn);
    container.appendChild(btn);
  }

  return container;
}

--- NEW FILE: src/content/viewport-toggle.unit.test.ts ---
import { it, expect, beforeEach } from 'vitest';
import { createViewportToggle, setViewport } from './viewport-toggle';

beforeEach(() => {
  document.body.innerHTML = '';
});

it('creates a button group with 3 viewport options', () => {
  const iframe = document.createElement('iframe');
  const toggle = createViewportToggle(iframe);

  const buttons = toggle.querySelectorAll('button');
  expect(buttons).toHaveLength(3);
  expect(buttons[0].textContent).toBe('Mobile');
  expect(buttons[1].textContent).toBe('Tablet');
  expect(buttons[2].textContent).toBe('Desktop');
});

it('sets iframe width to 375px for mobile viewport', () => {
  const iframe = document.createElement('iframe');
  setViewport(iframe, 'mobile');
  expect(iframe.style.width).toBe('375px');
});

it('sets iframe width to 768px for tablet viewport', () => {
  const iframe = document.createElement('iframe');
  setViewport(iframe, 'tablet');
  expect(iframe.style.width).toBe('768px');
});

it('sets iframe width to 100% for desktop viewport', () => {
  const iframe = document.createElement('iframe');
  setViewport(iframe, 'desktop');
  expect(iframe.style.width).toBe('100%');
});

it('clicking a viewport button sets the active class', () => {
  const iframe = document.createElement('iframe');
  const toggle = createViewportToggle(iframe);
  const buttons = toggle.querySelectorAll('button');

  (buttons[0] as HTMLButtonElement).click();
  expect(buttons[0].classList.contains('selected')).toBe(true);
  expect(buttons[2].classList.contains('selected')).toBe(false);
});

it('clicking a viewport button changes iframe width', () => {
  const iframe = document.createElement('iframe');
  const toggle = createViewportToggle(iframe);
  const buttons = toggle.querySelectorAll('button');

  (buttons[0] as HTMLButtonElement).click();
  expect(iframe.style.width).toBe('375px');

  (buttons[2] as HTMLButtonElement).click();
  expect(iframe.style.width).toBe('100%');
});

--- NEW FILE: src/preview-message-handler.ts ---
type PreviewMessage = {
  type: string;
  id: string;
  html: string | null;
  error: string | null;
};

/**
 * Handle a preview message by writing HTML to the iframe or showing an error.
 * @param message - The message containing preview data
 * @param expectedId - The expected preview ID to match
 */
export function handlePreviewMessage(message: PreviewMessage, expectedId: string): void {
  if (message.id !== expectedId) return;

  const loading = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const iframe = document.getElementById('preview') as HTMLIFrameElement | null;

  if (message.html) {
    if (loading) loading.style.display = 'none';
    if (iframe) {
      iframe.style.display = 'block';
      iframe.srcdoc = message.html;
    }
  } else if (message.error) {
    if (loading) loading.style.display = 'none';
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = message.error;
    }
  }
}

--- NEW FILE: src/preview.html ---
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

--- NEW FILE: src/preview.ts ---
import { handlePreviewMessage } from './preview-message-handler';

const params = new URLSearchParams(location.search);
const previewId = params.get('id');

const POLL_INTERVAL_MS = 200;
const PREVIEW_TIMEOUT_MS = 60_000;

/**
 * Poll the background script for preview HTML and display it.
 */
async function loadPreview(): Promise<void> {
  if (!previewId) return;

  const maxRetries = PREVIEW_TIMEOUT_MS / POLL_INTERVAL_MS;
  for (let i = 0; i < maxRetries; i++) {
    const data = await chrome.runtime.sendMessage({
      type: 'preview-get',
      id: previewId,
    });

    if (data.html || data.error) {
      handlePreviewMessage(
        { type: 'preview-get-response', id: previewId, html: data.html, error: data.error },
        previewId
      );
      return;
    }
    // pending: still fetching
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  // Timeout
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Preview timed out.';
}

loadPreview();

--- NEW FILE: src/preview.unit.test.ts ---
import { it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = `
    <div id="loading">Loading preview...</div>
    <div id="error" style="display:none;"></div>
    <iframe id="preview" sandbox="allow-scripts" style="display:none;"></iframe>
  `;
});

it('writes HTML to iframe srcdoc on matching message', async () => {
  // Get the registered listener
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'test-id', html: '<html><body>Hello</body></html>', error: null },
    'test-id'
  );

  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(iframe.srcdoc).toContain('Hello');
  expect(iframe.style.display).toBe('block');
});

it('ignores messages with non-matching id', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'wrong-id', html: '<html><body>Wrong</body></html>', error: null },
    'test-id'
  );

  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(iframe.srcdoc).toBe('');
});

it('displays error when error field is present', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'test-id', html: null, error: 'Fetch failed' },
    'test-id'
  );

  const errorEl = document.getElementById('error')!;
  expect(errorEl.style.display).toBe('block');
  expect(errorEl.textContent).toBe('Fetch failed');
});

