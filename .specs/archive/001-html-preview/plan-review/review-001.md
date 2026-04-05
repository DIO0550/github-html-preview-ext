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
// PR の head ブランチ情報から構築
// github.com/{owner}/{repo}/raw/{head-sha}/{path}
```

### 4.3 ボタン挿入

```typescript
// ボタンの識別用カスタム属性（重複防止）
const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';

// GitHub のボタンスタイルに合わせる
const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
```

exec
/bin/bash -lc "rg --files /workspace | rg '("'^|/)implementation-plan'"\\.md"'$|(''^|/)package'"\\.json"'$|(''^|/)README|(''^|/)src/|(''^|/)app/|(''^|/)server/|(''^|/)webview|(''^|/)extension'"'" in /workspace
 succeeded in 0ms:
/workspace/README.md
/workspace/package.json
/workspace/src/content.ts
/workspace/src/background.ts
/workspace/src/index.css
/workspace/src/options/index.html
/workspace/src/options/App.tsx
/workspace/src/options/index.tsx
/workspace/src/test/setup.ts

exec
/bin/bash -lc "ls -la /workspace && printf '\\n---\\n' && find /workspace -maxdepth 2 -type d | sort | sed -n '1,240p'" in /workspace
 succeeded in 0ms:
total 140
drwxr-xr-x 29 vscode vscode   928 Apr  5 07:51 .
drwxr-xr-x  1 root   root    4096 Apr  5 06:20 ..
drwxr-xr-x  4 vscode vscode   128 Apr  5 06:49 .claude
drwxr-xr-x  6 vscode vscode   192 Apr  5 06:20 .devcontainer
drwxr-xr-x 11 vscode vscode   352 Apr  5 08:44 .git
-rw-r--r--  1 vscode vscode  2259 Apr  5 07:50 .gitignore
-rw-r--r--  1 vscode vscode   182 Apr  5 05:49 .npmrc
drwxr-xr-x  3 vscode vscode    96 Apr  5 06:21 .playwright
drwxr-xr-x  3 vscode vscode    96 Apr  5 06:31 .pnpm-store
drwxr-xr-x  4 vscode vscode   128 Apr  5 07:51 .specs
-rw-r--r--  1 vscode vscode  2981 Apr  5 06:49 CLAUDE.md
-rw-r--r--  1 vscode vscode  1064 Apr  5 05:49 LICENSE
-rw-r--r--  1 vscode vscode    21 Apr  5 05:49 README.md
drwxr-xr-x  3 vscode vscode    96 Apr  5 06:34 docs
drwxr-xr-x 18 vscode vscode   576 Apr  5 06:31 node_modules
-rw-r--r--  1 vscode vscode   950 Apr  5 06:31 package.json
-rw-r--r--  1 vscode vscode 72535 Apr  5 06:31 pnpm-lock.yaml
-rw-r--r--  1 vscode vscode    58 Apr  5 05:49 postcss.config.js
drwxr-xr-x  3 vscode vscode    96 Apr  5 05:49 public
drwxr-xr-x  7 vscode vscode   224 Apr  5 05:49 src
-rw-r--r--  1 vscode vscode  1435 Apr  5 05:49 tailwind.config.js
-rw-r--r--  1 vscode vscode   246 Apr  5 05:49 tsconfig.app.json
-rw-r--r--  1 vscode vscode   529 Apr  5 05:49 tsconfig.base.json
-rw-r--r--  1 vscode vscode   159 Apr  5 05:49 tsconfig.json
-rw-r--r--  1 vscode vscode   233 Apr  5 05:49 tsconfig.node.json
-rw-r--r--  1 vscode vscode   175 Apr  5 05:49 tsconfig.test.json
-rw-r--r--  1 vscode vscode   570 Apr  5 05:49 vite.config.ts
-rw-r--r--  1 vscode vscode   408 Apr  5 05:49 vite.content.config.ts
-rw-r--r--  1 vscode vscode   298 Apr  5 05:49 vitest.config.ts

---
/workspace
/workspace/.claude
/workspace/.claude/skills
/workspace/.devcontainer
/workspace/.devcontainer/node
/workspace/.git
/workspace/.git/logs
/workspace/.git/objects
/workspace/.git/refs
/workspace/.playwright
/workspace/.pnpm-store
/workspace/.pnpm-store/v10
/workspace/.specs
/workspace/.specs/.guard
/workspace/.specs/001-html-preview
/workspace/docs
/workspace/node_modules
/workspace/node_modules/.bin
/workspace/node_modules/.pnpm
/workspace/node_modules/@testing-library
/workspace/node_modules/@types
/workspace/node_modules/@vitejs
/workspace/node_modules/@vitest
/workspace/public
/workspace/src
/workspace/src/options
/workspace/src/test

codex
計画書の後半と既存の拡張構成を確認します。実装対象は MV3 拡張なので、`manifest`、ビルド設定、既存の `content/background/options` の責務分割との噛み合わせを見ます。
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
    19	---
    20	
    21	## 2. システム図
    22	
    23	### 2.1 状態マシン図（コンテンツスクリプトのライフサイクル）
    24	
    25	```
    26	                          +-----------+
    27	                          |   IDLE    |
    28	                          | (初期状態) |
    29	                          +-----+-----+
    30	                                |
    31	                          page load / document_end
    32	                                |
    33	                                v
    34	                    +---------------------+
    35	                    |   OBSERVING         |
    36	                    | MutationObserver    |
    37	                    | 起動 + 初回スキャン   |
    38	                    +-----+--------+------+
    39	                          |        ^
    40	                 DOM変更検出 |        | debounce 後に再監視
    41	                          v        |
    42	                  +----------------+------+
    43	                  |  SCANNING             |
    44	                  |  ファイルヘッダ検出     |
    45	                  |  (.html判定)           |
    46	                  +---+------+------+-----+
    47	                      |      |      |
    48	            HTML なし  |      |      | エラー（DOM構造変更）
    49	            +---------+      |      +----------+
    50	            |                |                 |
    51	            v                v                 v
    52	     (OBSERVING       +------------+    +-----------+
    53	      に戻る)         | INSERTING  |    |   ERROR   |
    54	                      | ボタン挿入  |    | ログ出力   |
    55	                      +-----+------+    +-----+-----+
    56	                            |                 |
    57	                            v                 v
    58	                      +------------+    (OBSERVING
    59	                      |  WAITING   |     に戻る)
    60	                      | クリック待ち |
    61	                      +-----+------+
    62	                            |
    63	                      ユーザーがクリック
    64	                            |
    65	                            v
    66	                      +------------+
    67	                      |  FETCHING  |
    68	                      | raw HTML   |
    69	                      | fetch 実行  |
    70	                      +-----+------+
    71	                            |
    72	                +-----------+-----------+
    73	                |                       |
    74	          成功 (200)              失敗 / タイムアウト
    75	                |                       |
    76	                v                       v
    77	         +-------------+        +--------------+
    78	         |  PREVIEWING |        | FETCH_ERROR  |
    79	         | Blob生成     |        | ボタンに      |
    80	         | 新規タブ表示  |        | エラー表示    |
    81	         +------+------+        +------+-------+
    82	                |                       |
    83	                v                       v
    84	          (WAITING                (WAITING
    85	           に戻る)                 に戻る)
    86	```
    87	
    88	### 2.2 データフロー図
    89	
    90	#### Phase 1-2: 新規タブプレビュー
    91	
    92	```
    93	+----------+     click      +------------------+     fetch      +----------------+
    94	|  User    +--------------->| Content Script   +--------------->| github.com     |
    95	|          |                | (content.ts)     |  credentials:  | /raw/refs/     |
    96	+----------+                +--------+---------+  include       | heads/{branch} |
    97	                                     |                          | /{path}        |
    98	                                     |                          +-------+--------+
    99	                                     |                                  |
   100	                                     |                          302 redirect
   101	                                     |                                  |
   102	                                     |                                  v
   103	                                     |                          +----------------+
   104	                                     |                          | raw.github     |
   105	                                     |            response      | usercontent    |
   106	                                     |<-------------------------+ .com           |
   107	                                     |            (HTML text)   +----------------+
   108	                                     |
   109	                                     | new Blob([html], {type: 'text/html'})
   110	                                     | URL.createObjectURL(blob)
   111	                                     |
   112	                                     v
   113	                              +------+-------+
   114	                              | window.open  |
   115	                              | (blob:// URL)|
   116	                              | 新規タブ      |
   117	                              +--------------+
   118	```
   119	
   120	#### Phase 3: インライン iframe プレビュー
   121	
   122	```
   123	+----------+     click      +------------------+     fetch      +----------------+
   124	|  User    +--------------->| Content Script   +--------------->| github.com     |
   125	|          |                | (content.ts)     |                | /raw/...       |
   126	+----+-----+                +--------+---------+                +-------+--------+
   127	     |                               |                                  |
   128	     |                               |<---------------------------------+
   129	     |                               |  response (HTML text)
   130	     |                               |
   131	     |                               | new Blob([html], {type: 'text/html'})
   132	     |                               | URL.createObjectURL(blob)
   133	     |                               |
   134	     |                               v
   135	     |                      +--------+---------+
   136	     |                      | <iframe>         |
   137	     |    viewport toggle   | diff 直下に挿入   |
   138	     +--------------------->| src=blob:// URL  |
   139	     |   320px / 768px /    +--------+---------+
   140	     |   100%                        |
   141	     |                               |
   142	     |   "Open all HTML"             v
   143	     +------------------------> 一括プレビュー
   144	         PRヘッダの                  (全 .html ファイルを
   145	         ボタンから                   順次 fetch + iframe)
   146	```
   147	
   148	---
   149	
   150	## 3. ファイル構成
   151	
   152	### 変更ファイル
   153	
   154	| ファイル | 変更内容 |
   155	|---------|---------|
   156	| `public/manifest.json` | `name`, `description`, `matches`, `permissions` の更新 |
   157	| `src/content.ts` | エントリポイントとして各モジュールを統合 |
   158	| `src/background.ts` | 必要に応じて設定管理を追加 |
   159	| `src/test/setup.ts` | Chrome API モック拡張（fetch, Blob URL, window.open） |
   160	
   161	### 新規ファイル
   162	
   163	| ファイル | 責務 |
   164	|---------|------|
   165	| `src/content/types.ts` | 共通型定義（ButtonState, FileHeaderInfo 等） |
   166	| `src/content/url-utils.ts` | URL 変換（blob -> raw, パス抽出）。純粋関数 |
   167	| `src/content/url-utils.test.ts` | URL 変換のユニットテスト |
   168	| `src/content/github-dom.ts` | GitHub DOM セレクタ、ファイルヘッダ検出、HTML ファイル判定 |
   169	| `src/content/github-dom.test.ts` | DOM 検出のテスト（happy-dom） |
   170	| `src/content/preview-button.ts` | Preview ボタンの生成・挿入・重複防止・状態管理 |
   171	| `src/content/preview-button.test.ts` | ボタン挿入のテスト |
   172	| `src/content/html-fetcher.ts` | raw HTML の fetch + Blob 化 + window.open |
   173	| `src/content/html-fetcher.test.ts` | fetch フローのテスト（モック） |
   174	| `src/content/observer.ts` | MutationObserver + debounce |
   175	| `src/content/observer.test.ts` | Observer のテスト |
   176	| `src/content/iframe-preview.ts` | Phase 3: インライン iframe 生成・viewport 切替 |
   177	| `src/content/iframe-preview.test.ts` | Phase 3: iframe テスト |
   178	| `src/content/viewport-toggle.ts` | Phase 3: viewport 切替 UI |
   179	| `src/content/viewport-toggle.test.ts` | Phase 3: viewport 切替のテスト |
   180	| `src/content/batch-preview.ts` | Phase 3: 一括プレビュー |
   181	| `src/content/batch-preview.test.ts` | Phase 3: 一括プレビューのテスト |
   182	
   183	---
   184	
   185	## 4. Phase 1 (MVP) 実装詳細
   186	
   187	### 4.1 DOM セレクタ戦略
   188	
   189	GitHub PR の Files changed タブのファイルヘッダ検出は、複数セレクタでフォールバックする:
   190	
   191	```typescript
   192	const FILE_HEADER_SELECTORS = [
   193	  '[data-tagsearch-path]',           // data属性ベース（最安定）
   194	  '.file-header[data-path]',         // クラス + data属性
   195	  '.file-header',                    // クラスのみ（フォールバック）
   196	  'div[id^="diff-"]',               // diff コンテナ
   197	] as const;
   198	```
   199	
   200	パス取得も複数戦略でフォールバック:
   201	
   202	```typescript
   203	const FILE_PATH_EXTRACTORS = [
   204	  (el: Element) => el.getAttribute('data-tagsearch-path'),
   205	  (el: Element) => el.getAttribute('data-path'),
   206	  (el: Element) => el.querySelector('[title]')?.getAttribute('title'),
   207	] as const;
   208	```
   209	
   210	検出優先順位: `data-*` 属性 > `data-testid` > クラス名。
   211	
   212	### 4.2 URL 変換
   213	
   214	"View file" リンクの href を raw URL に変換する:
   215	
   216	```
   217	入力: /owner/repo/blob/{sha_or_branch}/{path}
   218	出力: /owner/repo/raw/{sha_or_branch}/{path}
   219	
   220	変換: "/blob/" -> "/raw/" の単純置換
   221	```
   222	
   223	`github.com` ドメインを付与した完全 URL で fetch する。日本語・スペース・特殊文字はブラウザが自動エンコードするが、`encodeURI` で正規化する。
   224	
   225	また、ファイルヘッダから直接 raw URL を構築するパターンも用意:
   226	
   227	```typescript
   228	// PR の head ブランチ情報から構築
   229	// github.com/{owner}/{repo}/raw/{head-sha}/{path}
   230	```
   231	
   232	### 4.3 ボタン挿入
   233	
   234	```typescript
   235	// ボタンの識別用カスタム属性（重複防止）
   236	const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';
   237	
   238	// GitHub のボタンスタイルに合わせる
   239	const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
   240	```
   241	
   242	挿入位置: ファイルヘッダ内の `.file-actions` または `.file-info`、末尾にフォールバック。既存のアクションボタン群の隣に配置。
   243	
   244	重複防止: `header.querySelector(PREVIEW_BUTTON_SELECTOR)` で既挿入チェック。
   245	
   246	### 4.4 fetch + Blob + 新規タブ
   247	
   248	```typescript
   249	async function fetchAndPreview(rawUrl: string): Promise<void> {
   250	  const response = await fetch(rawUrl, { credentials: 'include' });
   251	  if (!response.ok) throw new Error(`HTTP ${response.status}`);
   252	  const html = await response.text();
   253	  const blob = new Blob([html], { type: 'text/html' });
   254	  const blobUrl = URL.createObjectURL(blob);
   255	  window.open(blobUrl, '_blank');
   256	}
   257	```
   258	
   259	### 4.5 MutationObserver
   260	

exec
/bin/bash -lc "sed -n '1,220p' /workspace/package.json && printf '\\n---MANIFEST---\\n' && sed -n '1,220p' /workspace/public/manifest.json && printf '\\n---VITE CONTENT---\\n' && sed -n '1,220p' /workspace/vite.content.config.ts && printf '\\n---VITEST---\\n' && sed -n '1,220p' /workspace/vitest.config.ts" in /workspace
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

---MANIFEST---
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

---VITE CONTENT---
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

---VITEST---
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

exec
/bin/bash -lc "printf '%s\\n' '---src/content.ts---' && sed -n '1,220p' /workspace/src/content.ts && printf '%s\\n' '---src/background.ts---' && sed -n '1,220p' /workspace/src/background.ts && printf '%s\\n' '---src/options/App.tsx---' && sed -n '1,220p' /workspace/src/options/App.tsx && printf '%s\\n' '---src/test/setup.ts---' && sed -n '1,220p' /workspace/src/test/setup.ts" in /workspace
 succeeded in 0ms:
---src/content.ts---
// Content script
// This script runs in the context of web pages

console.log('Content script loaded');
---src/background.ts---
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});
---src/options/App.tsx---
function App() {
  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold text-foreground">Extension Options</h1>
      <p className="mt-4 text-muted-foreground">Configure your extension settings here.</p>
    </div>
  );
}

export default App;
---src/test/setup.ts---
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

exec
/bin/bash -lc "nl -ba /workspace/.specs/001-html-preview/implementation-plan.md | sed -n '260,520p'" in /workspace
 succeeded in 0ms:
   260	
   261	GitHub PR は diff を遅延読み込みするため、DOM 変更を監視してボタンを挿入する:
   262	
   263	```typescript
   264	const observer = new MutationObserver(() => {
   265	  addPreviewButtons();
   266	});
   267	
   268	observer.observe(document.body, {
   269	  childList: true,
   270	  subtree: true,
   271	});
   272	
   273	// 初回スキャン
   274	addPreviewButtons();
   275	```
   276	
   277	---
   278	
   279	## 5. Phase 2 (堅牢化) 実装詳細
   280	
   281	### 5.1 エラーハンドリング
   282	
   283	fetch 失敗時のユーザーフィードバック:
   284	
   285	```
   286	+------------------+     +-------------------+     +------------------+
   287	| fetch 実行       | --> | レスポンス判定     | --> | 成功: プレビュー  |
   288	+------------------+     +---+---------------+     +------------------+
   289	                             |
   290	                             | 失敗
   291	                             v
   292	                   +---------+----------+
   293	                   | エラー種別判定      |
   294	                   +--+------+------+---+
   295	                      |      |      |
   296	                      v      v      v
   297	                  network  401/   その他
   298	                  error    403
   299	                      |      |      |
   300	                      v      v      v
   301	                  "Network "Session "Preview
   302	                   error"  expired" failed"
   303	```
   304	
   305	ボタンの状態管理:
   306	
   307	```typescript
   308	type ButtonState = 'idle' | 'loading' | 'error';
   309	```
   310	
   311	ボタンのテキストを一時的にエラーメッセージに変更し、3秒後に復帰する。
   312	
   313	セッション切れ検知: レスポンスの URL がログインページにリダイレクトされた場合を判定。
   314	
   315	### 5.2 Blob URL 解放
   316	
   317	```typescript
   318	const BLOB_URL_LIFETIME_MS = 30_000; // 30秒
   319	
   320	// 既存 Blob URL の管理マップ
   321	const blobUrls: Map<string, { url: string; createdAt: number }> = new Map();
   322	
   323	function createManagedBlobUrl(blob: Blob, key: string): string {
   324	  // 既存の Blob URL があれば解放
   325	  const existing = blobUrls.get(key);
   326	  if (existing) URL.revokeObjectURL(existing.url);
   327	
   328	  const url = URL.createObjectURL(blob);
   329	  blobUrls.set(key, { url, createdAt: Date.now() });
   330	
   331	  setTimeout(() => {
   332	    URL.revokeObjectURL(url);
   333	    blobUrls.delete(key);
   334	  }, BLOB_URL_LIFETIME_MS);
   335	
   336	  return url;
   337	}
   338	```
   339	
   340	### 5.3 テーマ対応
   341	
   342	GitHub の `data-color-mode` 属性と既存 CSS 変数を活用:
   343	
   344	```typescript
   345	function getTheme(): 'light' | 'dark' {
   346	  return document.documentElement.getAttribute('data-color-mode') === 'dark'
   347	    ? 'dark' : 'light';
   348	}
   349	```
   350	
   351	GitHub ネイティブの `btn` クラスを使うことで基本的に自動追従する。カスタムスタイルが必要な場合のみ `--color-btn-bg`, `--color-btn-text` 等の CSS 変数を参照。
   352	
   353	### 5.4 debounce
   354	
   355	MutationObserver の過剰発火を抑制:
   356	
   357	```typescript
   358	function debounce<T extends (...args: unknown[]) => void>(
   359	  fn: T,
   360	  delay: number
   361	): T {
   362	  let timer: ReturnType<typeof setTimeout> | null = null;
   363	  return ((...args: unknown[]) => {
   364	    if (timer) clearTimeout(timer);
   365	    timer = setTimeout(() => fn(...args), delay);
   366	  }) as T;
   367	}
   368	
   369	// 使用: 150ms debounce
   370	const debouncedAddButtons = debounce(addPreviewButtons, 150);
   371	const observer = new MutationObserver(debouncedAddButtons);
   372	```
   373	
   374	### 5.5 折り畳み対応
   375	
   376	diff が collapsed 状態のファイルにもボタンを挿入。ファイルヘッダは折り畳み時も表示されるため、通常のセレクタで対応可能。
   377	
   378	---
   379	
   380	## 6. Phase 3 (拡張) 実装詳細
   381	
   382	### 6.1 インライン iframe プレビュー
   383	
   384	diff ブロックの直下に iframe を挿入:
   385	
   386	```typescript
   387	function createInlinePreview(
   388	  container: Element,
   389	  blobUrl: string,
   390	  viewportWidth: string
   391	): HTMLIFrameElement {
   392	  const iframe = document.createElement('iframe');
   393	  iframe.src = blobUrl;
   394	  iframe.style.cssText = `
   395	    width: ${viewportWidth};
   396	    height: 400px;
   397	    border: 1px solid var(--color-border-default);
   398	    border-radius: 6px;
   399	    resize: vertical;
   400	    overflow: auto;
   401	  `;
   402	  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
   403	  container.appendChild(iframe);
   404	  return iframe;
   405	}
   406	```
   407	
   408	トグル動作: 「Inline Preview」ボタンをクリックで展開/折り畳み。
   409	
   410	### 6.2 viewport 切替
   411	
   412	```
   413	+------------------------------------------+
   414	| [Mobile 375px] [Tablet 768px] [Desktop]  |  <-- 切替 UI
   415	+------------------------------------------+
   416	| +--------------------------------------+ |
   417	| |          iframe preview              | |
   418	| |      (width 動的変更)                 | |
   419	| +--------------------------------------+ |
   420	+------------------------------------------+
   421	```
   422	
   423	プリセット:
   424	
   425	```typescript
   426	const VIEWPORTS = {
   427	  mobile:  { width: '375px',  label: 'Mobile' },
   428	  tablet:  { width: '768px',  label: 'Tablet' },
   429	  desktop: { width: '100%',   label: 'Desktop' },
   430	} as const;
   431	```
   432	
   433	### 6.3 一括プレビュー
   434	
   435	PR ヘッダ付近に「Preview all HTML files」ボタンを追加:
   436	
   437	```typescript
   438	async function previewAllHtml(): Promise<void> {
   439	  const htmlHeaders = findAllHtmlFileHeaders();
   440	  for (const header of htmlHeaders) {
   441	    const rawUrl = getRawUrlFromHeader(header);
   442	    if (rawUrl) await fetchHtmlAndOpen(rawUrl);
   443	  }
   444	}
   445	```
   446	
   447	### 6.4 blob/ ページ対応
   448	
   449	manifest.json の matches を拡張:
   450	
   451	```json
   452	{
   453	  "matches": [
   454	    "https://github.com/*/pull/*/files",
   455	    "https://github.com/*/blob/*/*.html"
   456	  ]
   457	}
   458	```
   459	
   460	`/blob/` ページでは既存の "Raw" ボタンの隣に "Preview" を追加。ページタイプに応じたセレクタを使い分け。
   461	
   462	---
   463	
   464	## 7. テスト戦略
   465	
   466	### 7.1 テスト環境
   467	
   468	- **ランナー**: Vitest
   469	- **DOM 環境**: happy-dom
   470	- **モック基盤**: `src/test/setup.ts` で Chrome API + ブラウザ API をモック
   471	- **方針**: TDD（Red-Green-Refactor サイクル）
   472	
   473	### 7.2 追加モック（setup.ts に追加）
   474	
   475	```typescript
   476	// fetch モック
   477	vi.stubGlobal('fetch', vi.fn());
   478	
   479	// Blob URL
   480	const originalURL = globalThis.URL;
   481	vi.stubGlobal('URL', {
   482	  ...originalURL,
   483	  createObjectURL: vi.fn(() => 'blob:mock-url'),
   484	  revokeObjectURL: vi.fn(),
   485	});
   486	
   487	// window.open
   488	vi.stubGlobal('open', vi.fn());
   489	```
   490	
   491	### 7.3 機能タイプ分類とテストパターン
   492	
   493	| 機能タイプ | テスト方法 | 対象モジュール |
   494	|-----------|-----------|--------------|
   495	| 純粋関数 | 入力 -> 出力の検証。DOM 不要 | url-utils, debounce |
   496	| DOM 検出 | happy-dom で GitHub 風 DOM を構築 -> 関数実行 -> 結果検証 | github-dom |
   497	| DOM 操作 | happy-dom で DOM 構築 -> 操作実行 -> DOM 状態検証 | preview-button, iframe-preview, viewport-toggle |
   498	| 非同期 I/O | fetch モック -> 関数実行 -> モック呼び出し検証 | html-fetcher |
   499	| Observer | happy-dom の DOM 変更トリガー -> コールバック検証 | observer |
   500	| 統合 | 上記を組み合わせたフロー検証 | content.ts |
   501	
   502	### 7.4 テスト順序（TDD サイクル）
   503	
   504	```
   505	Phase 1:
   506	  1. url-utils.test.ts        <-- 純粋関数（最もテストしやすい）
   507	  2. github-dom.test.ts       <-- DOM 検出（happy-dom）
   508	  3. preview-button.test.ts   <-- DOM 操作
   509	  4. html-fetcher.test.ts     <-- fetch モック
   510	  5. observer.test.ts         <-- MutationObserver
   511	
   512	Phase 2:
   513	  6. エラーハンドリングのテスト追加（html-fetcher.test.ts 拡張）
   514	  7. Blob URL 解放のテスト追加（html-fetcher.test.ts 拡張）
   515	  8. debounce ユーティリティのテスト（observer.test.ts 拡張）
   516	  9. テーマ検出のテスト（github-dom.test.ts 拡張）
   517	
   518	Phase 3:
   519	  10. iframe-preview.test.ts
   520	  11. viewport-toggle.test.ts

exec
/bin/bash -lc "nl -ba /workspace/.specs/001-html-preview/implementation-plan.md | sed -n '520,760p'" in /workspace
 succeeded in 0ms:
   520	  11. viewport-toggle.test.ts
   521	  12. batch-preview.test.ts
   522	```
   523	
   524	### 7.5 テストパターン詳細
   525	
   526	**純粋関数テスト（url-utils）**:
   527	- 正常系: `/blob/` -> `/raw/` 変換
   528	- 日本語パス、スペース、特殊文字
   529	- 不正な URL（/blob/ を含まない）
   530	
   531	**DOM 検出テスト（github-dom）**:
   532	- 各セレクタパターンでのファイルヘッダ検出
   533	- .html ファイルのフィルタリング
   534	- セレクタフォールバック
   535	
   536	**DOM 操作テスト（preview-button）**:
   537	- ボタン生成の属性・クラス検証
   538	- 挿入位置の検証
   539	- 重複防止
   540	
   541	**非同期 I/O テスト（html-fetcher）**:
   542	- fetch 成功 -> Blob 生成 -> window.open 呼び出し
   543	- fetch 失敗（ネットワークエラー、401、403、500）
   544	- セッション切れ（リダイレクト先がログインページ）
   545	
   546	---
   547	
   548	## 8. 技術的制約とリスク対策
   549	
   550	| リスク | 影響度 | 対策 |
   551	|-------|--------|------|
   552	| GitHub DOM 構造変更 | 高 | 複数セレクタでフォールバック。`data-*` 属性優先 |
   553	| セッション切れ | 中 | fetch レスポンスのステータスコード + URL 判定。ユーザー通知 |
   554	| 大きな HTML ファイル | 低 | Blob 化は数百 KB でも問題なし。ローディング表示で UX 担保 |
   555	| CSP 制約 | 低 | Blob URL は CSP 制約を受けにくい（検証済み） |
   556	| 日本語/特殊文字パス | 中 | `encodeURI` で正規化。テストケースに含める |
   557	| Blob URL メモリリーク | 中 | タイマーベースの `revokeObjectURL` (30秒)。Phase 2 で対応 |
   558	| MutationObserver 過剰発火 | 中 | debounce (150ms)。Phase 2 で対応 |
   559	| コンテンツスクリプト IIFE 制約 | 低 | Vite がバンドル時に解決。ソースでは import 可能 |
   560	| `<base>` タグや絶対パス依存の HTML | 低 | 表示崩れが起きた場合 Phase 2 以降で対策判断 |
   561	| 外部 CDN 依存の JS | 低 | 通常通り CORS/CSP に従う。個別対応 |
   562	
   563	---
   564	
   565	## 9. Definition of Done
   566	
   567	### Phase 1 (MVP)
   568	
   569	- [ ] `public/manifest.json` の matches が `https://github.com/*/pull/*/files` に設定されている
   570	- [ ] `.html` ファイルのヘッダに「Preview」ボタンが表示される
   571	- [ ] ボタンクリックで新規タブに HTML がレンダリングされる
   572	- [ ] 遅延読み込みされた diff にもボタンが挿入される（MutationObserver）
   573	- [ ] 重複ボタンが挿入されない
   574	- [ ] url-utils, github-dom, preview-button, html-fetcher, observer の全ユニットテストが Green
   575	- [ ] `pnpm build` が成功する
   576	- [ ] 3 ファイル以上の HTML を含む PR で動作確認
   577	
   578	### Phase 2 (堅牢化)
   579	
   580	- [ ] fetch 失敗時にボタン上にエラーメッセージが表示される
   581	- [ ] セッション切れが検知・通知される
   582	- [ ] Blob URL が 30 秒後に自動解放される
   583	- [ ] ダーク/ライトテーマでボタンスタイルが適切
   584	- [ ] MutationObserver が debounce (150ms) されている
   585	- [ ] 折り畳まれた diff でもボタンが機能する
   586	- [ ] エラーハンドリングのテストが通る
   587	- [ ] 10 ファイル以上の PR で動作確認
   588	
   589	### Phase 3 (拡張)
   590	
   591	- [ ] diff 下部にインライン iframe でプレビュー表示可能
   592	- [ ] iframe のリサイズ（ドラッグ）が可能
   593	- [ ] Desktop/Tablet/Mobile の viewport 切替が動作する
   594	- [ ] PR ヘッダに「Preview All HTML」ボタンが表示される
   595	- [ ] `/blob/` ページでも Preview ボタンが表示される
   596	- [ ] 各拡張機能のテストが通る

codex
計画書だけでは判断しきれない前提を減らすため、同じ spec 配下の要件定義も見ます。特に URL 変換、対象画面、MVP 範囲が要求とずれていないかを確認します。
exec
/bin/bash -lc "find /workspace/.specs/001-html-preview -maxdepth 2 -type f | sort | sed -n '1,200p'" in /workspace
 succeeded in 0ms:
/workspace/.specs/001-html-preview/PLANNING
/workspace/.specs/001-html-preview/exploration-report.md
/workspace/.specs/001-html-preview/hearing-notes.md
/workspace/.specs/001-html-preview/implementation-plan.md
/workspace/.specs/001-html-preview/plan-review/prompt-001.txt
/workspace/.specs/001-html-preview/plan-review/review-001.md
/workspace/.specs/001-html-preview/tasks.md

exec
/bin/bash -lc 'for f in /workspace/.specs/001-html-preview/*; do [ -f "$f" ] && { echo "--- $f ---"; sed -n '"'1,220p' \""'$f"; }; done' in /workspace
 succeeded in 0ms:
--- /workspace/.specs/001-html-preview/PLANNING ---
54795975-1484-45e6-8c61-5c12a4c452d6
--- /workspace/.specs/001-html-preview/exploration-report.md ---
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
--- /workspace/.specs/001-html-preview/hearing-notes.md ---
# Hearing Notes: GitHub PR HTML Preview

## 目的

GitHub の Private repo の PR 画面 (Files changed タブ) で、変更された HTML ファイルの隣に「Preview」ボタンを表示し、クリックすると新規タブでレンダリング結果を確認できるようにする。Claude Code on the web が作った PR を、ダウンロードせずにブラウザ上でレビュー・マージできる状態を作る。

## スコープ

- **種別**: 新規機能
- **影響範囲**: 新規（既存テンプレートの content.ts, background.ts, manifest.json を拡張）
- **優先度**: 高
- **Phase 1 (MVP)**: Preview ボタン表示 + クリックで新規タブプレビュー + MutationObserver による遅延読み込み対応
- **Phase 2 (堅牢化)**: エラーハンドリング、Blob URL 解放、ダーク/ライトテーマ対応、折り畳み対応、MutationObserver debounce
- **Phase 3 (拡張)**: インライン iframe プレビュー、viewport 切替、一括プレビュー、PR 以外への拡張

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
--- /workspace/.specs/001-html-preview/implementation-plan.md ---
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
--- /workspace/.specs/001-html-preview/tasks.md ---
# Tasks: GitHub PR HTML Preview

TDD ベース（Red-Green-Refactor サイクル）で Phase 順に実装を進める。
各タスクではテストを先に書き、テストが失敗する（RED）ことを確認してから実装（GREEN）し、必要に応じてリファクタリングする。

---

## Phase 0: インフラ準備

- [ ] **T-00: テストインフラ拡張**
  - **説明**: `src/test/setup.ts` に fetch, URL.createObjectURL/revokeObjectURL, window.open のモックを追加する。既存の Chrome API モック（storage, runtime, contextMenus）はそのまま維持する。
  - **テストファースト**: モック追加後に `pnpm test` を実行し、既存テスト（もしあれば）が壊れないことを確認。
  - **完了条件**: `pnpm test` がパスする。fetch, URL.createObjectURL, URL.revokeObjectURL, window.open がテストで利用可能になっている。

- [ ] **T-01: manifest.json 更新**
  - **説明**: `public/manifest.json` を以下の通り更新する。
    - `name` -> "GitHub PR HTML Preview"
    - `description` -> "Preview HTML files directly from GitHub PR's Files changed tab"
    - `matches` -> `["https://github.com/*/pull/*/files"]`
    - `permissions` に `"activeTab"` を追加
  - **テストファースト**: N/A（設定ファイル変更のため）
  - **完了条件**: `pnpm build` が成功する。manifest.json の内容が正しい。

- [ ] **T-02: 共通型定義の作成**
  - **説明**: `src/content/types.ts` を作成し、各モジュール間で共有する型を定義する。
    - `FileHeaderInfo`: ファイルパス、raw URL、ヘッダ要素への参照
    - `ButtonState`: `'idle' | 'loading' | 'error'`
    - `PreviewMode`: `'new-tab' | 'inline'`
  - **テストファースト**: N/A（型定義のため）
  - **完了条件**: 型定義ファイルが作成され、`pnpm build` が成功する。

---

## Phase 1: MVP

### url-utils（URL 変換 -- 純粋関数）

- [ ] **T-10: RED - url-utils のテストを書く**
  - **説明**: `src/content/url-utils.test.ts` を作成し、URL 変換ロジックのテストケースを書く。
  - **テストケース**:
    - `/blob/` -> `/raw/` 変換（通常のパス）
    - 日本語を含むファイルパス
    - スペースを含むファイルパス
    - 特殊文字（`#`, `?`, `&`）を含むパス
    - `/blob/` を含まない不正な URL -> null またはエラー
    - 完全な URL（`https://github.com/...`）と相対パスの両方
  - **完了条件**: テストが RED（失敗）になる。実装ファイルは未作成。

- [ ] **T-11: GREEN - url-utils を実装する**
  - **説明**: `src/content/url-utils.ts` を作成し、`convertBlobToRawUrl` 関数を実装する。`/blob/` を `/raw/` に置換する純粋関数。HTML ファイル判定の `isHtmlFile` も実装する。
  - **テストファースト**: T-10 で書いたテストを通すことだけに集中する。
  - **完了条件**: T-10 のテストが全て GREEN になる。

- [ ] **T-12: REFACTOR - url-utils をリファクタリング**
  - **説明**: テストが通っている状態を維持しつつ、コードを整理する。エッジケースの追加や関数シグネチャの改善があれば行う。
  - **完了条件**: テストが全て GREEN。コードが読みやすく整理されている。

### github-dom（DOM セレクタ・ファイルヘッダ検出）

- [ ] **T-13: RED - github-dom のテストを書く**
  - **説明**: `src/content/github-dom.test.ts` を作成。happy-dom 上で GitHub PR Files changed タブの DOM 構造をモック構築し、検出ロジックをテストする。
  - **テストケース**:
    - `[data-tagsearch-path]` 属性を持つ要素の検出
    - `.file-header` クラスの要素の検出（フォールバック）
    - `.html` ファイルのフィルタリング（.js, .css 等は除外）
    - ファイルパスの取得（`data-tagsearch-path`, `data-path`, `title` 属性）
    - "View file" リンク（`a[href*="/blob/"]`）の href 取得
    - 処理済み（ボタン挿入済み）ヘッダの除外
  - **完了条件**: テストが RED になる。

- [ ] **T-14: GREEN - github-dom を実装する**
  - **説明**: `src/content/github-dom.ts` を作成。以下の関数を実装:
    - `findHtmlFileHeaders()`: 全ファイルヘッダから .html のみを返す
    - `getFilePath(header)`: ヘッダ要素からファイルパスを取得
    - `getRawUrl(header)`: ヘッダ要素から raw URL を構築
    - `isAlreadyProcessed(header)`: ボタン挿入済みか判定
  - **完了条件**: T-13 のテストが全て GREEN。

- [ ] **T-15: REFACTOR - github-dom をリファクタリング**
  - **説明**: セレクタ定数の整理、関数の責務分離を改善。
  - **完了条件**: テストが全て GREEN。

### preview-button（ボタン生成・挿入）

- [ ] **T-16: RED - preview-button のテストを書く**
  - **説明**: `src/content/preview-button.test.ts` を作成。
  - **テストケース**:
    - ボタン要素の生成（クラス名、テキスト、属性の検証）
    - ファイルヘッダへのボタン挿入（`.file-actions` への挿入）
    - 挿入位置のフォールバック（`.file-info` やヘッダ末尾）
    - 重複防止（既にボタンがある場合は挿入しない）
    - クリックハンドラの呼び出し検証
  - **完了条件**: テストが RED になる。

- [ ] **T-17: GREEN - preview-button を実装する**
  - **説明**: `src/content/preview-button.ts` を作成。以下の関数を実装:
    - `createPreviewButton(onPreview)`: ボタン要素を生成
    - `insertPreviewButton(header, button)`: ヘッダにボタンを挿入
    - `addPreviewButtonToHeader(header, rawUrl)`: ヘッダに対してボタン生成から挿入まで一括実行
  - **完了条件**: T-16 のテストが全て GREEN。

- [ ] **T-18: REFACTOR - preview-button をリファクタリング**
  - **説明**: ボタンスタイル定数の整理、挿入ロジックの簡潔化。
  - **完了条件**: テストが全て GREEN。

### html-fetcher（HTML 取得 + Blob URL + 新規タブ）

- [ ] **T-19: RED - html-fetcher のテストを書く**
  - **説明**: `src/content/html-fetcher.test.ts` を作成。fetch, URL.createObjectURL, window.open をモックして検証。
  - **テストケース**:
    - 正常系: fetch 成功 -> Blob 生成 -> window.open 呼び出し
    - fetch に `credentials: 'include'` が渡されていることの検証
    - Blob の type が `'text/html'` であることの検証
    - window.open に blob URL と `'_blank'` が渡されることの検証
  - **完了条件**: テストが RED になる。

- [ ] **T-20: GREEN - html-fetcher を実装する**
  - **説明**: `src/content/html-fetcher.ts` を作成。`fetchHtmlAndOpen(rawUrl)` を実装。
  - **完了条件**: T-19 のテストが全て GREEN。

- [ ] **T-21: REFACTOR - html-fetcher をリファクタリング**
  - **説明**: 関数の責務分離（fetch と open を分離）を検討。
  - **完了条件**: テストが全て GREEN。

### observer（MutationObserver）

- [ ] **T-22: RED - observer のテストを書く**
  - **説明**: `src/content/observer.test.ts` を作成。
  - **テストケース**:
    - DOM 変更時にコールバックが呼び出される
    - 観測開始で `document.body` の `childList` + `subtree` を監視
    - 観測停止（`disconnect`）が可能
    - 初回スキャン（observer 開始時に即座にコールバック実行）
  - **完了条件**: テストが RED になる。

- [ ] **T-23: GREEN - observer を実装する**
  - **説明**: `src/content/observer.ts` を作成。以下の関数を実装:
    - `startObserving(callback)`: MutationObserver を開始し、初回スキャンも実行
    - `stopObserving()`: MutationObserver を停止
  - **完了条件**: T-22 のテストが全て GREEN。

- [ ] **T-24: REFACTOR - observer をリファクタリング**
  - **説明**: observer のライフサイクル管理を改善。
  - **完了条件**: テストが全て GREEN。

### 統合

- [ ] **T-25: content.ts 統合 + ビルド確認**
  - **説明**: `src/content.ts` を書き換え、全モジュールを統合する。
    - `url-utils`, `github-dom`, `preview-button`, `html-fetcher`, `observer` をインポート
    - `addPreviewButtons()` 関数を定義（github-dom でヘッダ検出 -> preview-button で挿入）
    - `startObserving(addPreviewButtons)` で監視開始
  - **テストファースト**: 統合テストを書いてからエントリポイントを実装する（オプション）。
  - **完了条件**: `pnpm build` が成功する。`pnpm test` が全てパスする。`dist/assets/content.js` が IIFE として生成される。

---

## Phase 2: 堅牢化

### エラーハンドリング

- [ ] **T-26: RED - エラーハンドリングのテストを追加**
  - **説明**: `html-fetcher.test.ts` と `preview-button.test.ts` にエラーケースのテストを追加する。
  - **テストケース**:
    - fetch ネットワークエラー時にボタンが "Network error" 状態になる
    - fetch 401/403 時にボタンが "Session expired" 状態になる
    - fetch その他エラー時にボタンが "Preview failed" 状態になる
    - エラー表示が 3 秒後に元に戻る
    - ボタン loading 状態の表示（"Loading..." + disabled）
  - **完了条件**: テストが RED になる。

- [ ] **T-27: GREEN - エラーハンドリングを実装する**
  - **説明**: `preview-button.ts` に `updateButtonState(btn, state, message?)` を追加。`html-fetcher.ts` にエラー種別判定とボタン状態更新を追加。セッション切れはレスポンス URL のチェックで検知。
  - **完了条件**: T-26 のテストが全て GREEN。

### Blob URL ライフサイクル管理

- [ ] **T-28: RED - Blob URL 管理のテストを追加**
  - **説明**: `html-fetcher.test.ts` に Blob URL ライフサイクルのテストを追加する。
  - **テストケース**:
    - Blob URL が 30 秒後に `revokeObjectURL` で解放される
    - 同じファイルの再プレビュー時に既存 Blob URL が解放される
    - 複数ファイルの Blob URL が独立に管理される
  - **完了条件**: テストが RED になる。

- [ ] **T-29: GREEN - Blob URL 管理を実装する**
  - **説明**: `html-fetcher.ts` に `createManagedBlobUrl(blob, key)` を実装。Map で管理し、タイマーベースで 30 秒後に自動解放。
  - **完了条件**: T-28 のテストが全て GREEN。

### テーマ対応

- [ ] **T-30: ダーク/ライトテーマ対応**
  - **説明**: ボタンが GitHub の既存 CSS 変数（`--color-btn-bg` 等）を使用してテーマに自動追従することを確認。必要であればカスタムスタイルを追加。
  - **テストファースト**: `github-dom.test.ts` に `data-color-mode` 属性の検出テストを追加。
  - **完了条件**: ダークモード/ライトモードでボタンが適切に表示される。テストがパスする。

### debounce

- [ ] **T-31: RED - debounce のテストを書く**
  - **説明**: `observer.test.ts` に debounce のテストを追加する。
  - **テストケース**:
    - 150ms 以内の連続呼び出しで最後の 1 回のみ実行される
    - 150ms 経過後に別の呼び出しがあれば再度実行される
    - コールバックの引数が正しく渡される
  - **完了条件**: テストが RED になる。

- [ ] **T-32: GREEN - debounce を実装する**
  - **説明**: `observer.ts` に `debounce(fn, delay)` ユーティリティを実装。MutationObserver のコールバックを debounce (150ms) でラップ。
  - **完了条件**: T-31 のテストが全て GREEN。

### Phase 2 統合

- [ ] **T-33: Phase 2 統合 + リグレッションテスト**
  - **説明**: Phase 2 の全変更を content.ts に反映。全テストが通ることを確認。
  - **完了条件**: `pnpm build` 成功。`pnpm test` 全パス。

---

## Phase 3: 拡張


exec
/bin/bash -lc "sed -n '1,260p' /workspace/docs/plan.md" in /workspace
 succeeded in 0ms:
# GitHub PR HTML Preview ユーザースクリプト 実装計画

## ゴール

GitHub の Private repo の PR 画面(Files changed タブ)で、変更された HTML ファイルの隣に「Preview」ボタンを表示し、クリックすると新規タブでレンダリング結果を確認できるようにする。

Claude Code on the web が作った PR を、ダウンロードせずにブラウザ上でレビュー → マージできる状態を作る。

## 背景と制約

- GitHub は repo ビューで HTML を描画しない(.html はソース表示になる)
- GitHub Pages の private preview は Enterprise プラン限定
- GitHub Actions は月2000分無料だが、教育HTML量産で枯渇する可能性あり
- PAT 管理は避けたい

→ **ログイン済みブラウザセッションのクッキーを使ってユーザースクリプトで raw を fetch する** 方式を採用。

### 検証済み事項

`github.com/{owner}/{repo}/raw/refs/heads/{branch}/{path}` に対して `fetch(url, { credentials: 'include' })` を実行すると、セッションクッキー経由で認証され、短命トークン付きの `raw.githubusercontent.com` URL にリダイレクトされ、HTMLコンテンツが取得できることを確認済み。

- `status: 200`
- `redirected: true`
- `type: "cors"`(GitHub側でCORSヘッダが適切に設定されている)

## 全体方針

- **実装形態**: Violentmonkey 用ユーザースクリプト(OSSのためTampermonkeyより推奨)
- **認証**: ログイン済みセッションクッキー(`credentials: 'include'`)
- **開発方針**: 小さく動かして動作確認しながら育てる

## Phase 0: セットアップ(5分)

1. Chrome に Violentmonkey をインストール(未導入の場合)
2. 新規スクリプト作成、メタデータのみの空スクリプトを作成
3. `@match https://github.com/*/pull/*/files` を指定
4. PR の Files changed タブで Violentmonkey アイコンにスクリプトが点灯することを確認

## Phase 1: MVP(30分〜1時間)

**目標**: PR画面のファイルヘッダ横に Preview ボタンが出て、クリックで新規タブに HTML がレンダリングされる。

### 実装要素

1. **DOM セレクタ確定**
   - 実際のPR画面のDevToolsで、ファイルヘッダ要素の構造を確認
   - `.file-header` なのか `[data-testid="..."]` なのか
   - `data-path` 属性の有無
   - "View file" リンクの実際の href 形式
   - **ここが最大のハマりポイントなので最初に確定させる**

2. **HTMLファイル検出**
   - `.html` で終わる path を持つヘッダのみ対象

3. **Previewボタン挿入**
   - GitHub の既存ボタンスタイル(`.btn .btn-sm`)に合わせる
   - ヘッダ内の適切な位置に追加

4. **クリックハンドラ**
   - "View file" リンクの href(`/blob/{sha}/{path}`)を `/raw/{sha}/{path}` に置換
   - `fetch(url, { credentials: 'include' })` で取得
   - `Blob` 化して `window.open` で新規タブに表示

5. **MutationObserver**
   - PR の diff は lazy load されるため、DOM変更を監視
   - 新しいヘッダが現れたら再度ボタン挿入を試みる
   - **重複防止フラグ必須**

### 完了判定

3〜4ファイル以上の HTML を含む PR で、全ファイルにボタンが出て、全部クリックでプレビューできる。

### 骨格コード

```javascript
// ==UserScript==
// @name         GitHub PR HTML Preview
// @match        https://github.com/*/pull/*/files
// @grant        none
// ==/UserScript==

(() => {
  const addPreviewButtons = () => {
    // セレクタはPhase 1のDOM確認結果で調整
    document
      .querySelectorAll('.file-header, [data-testid="file-header"]')
      .forEach((header) => {
        const path =
          header.dataset.path || header.getAttribute("data-tagsearch-path");
        if (!path || !path.endsWith(".html")) return;
        if (header.querySelector(".html-preview-btn")) return;

        const viewFileLink = header.querySelector('a[href*="/blob/"]');
        if (!viewFileLink) return;
        const rawUrl = viewFileLink.href.replace("/blob/", "/raw/");

        const btn = document.createElement("button");
        btn.textContent = "Preview HTML";
        btn.className = "html-preview-btn btn btn-sm";
        btn.style.marginLeft = "8px";
        btn.onclick = async (e) => {
          e.preventDefault();
          const res = await fetch(rawUrl, { credentials: "include" });
          const html = await res.text();
          const blob = new Blob([html], { type: "text/html" });
          window.open(URL.createObjectURL(blob), "_blank");
        };

        const insertTarget = header.querySelector(".file-info") || header;
        insertTarget.appendChild(btn);
      });
  };

  const observer = new MutationObserver(addPreviewButtons);
  observer.observe(document.body, { childList: true, subtree: true });
  addPreviewButtons();
})();
```

## Phase 2: 堅牢化(30分)

MVPが動いたら実用で詰まる部分を潰す。

- **エラーハンドリング**
  - fetch 失敗時にボタン上にエラー表示
  - ネットワーク切れやセッション切れ(リダイレクト先がログイン画面)を検知
- **Blob URL の解放**
  - `URL.revokeObjectURL` で一定時間後にメモリ解放
- **ボタンスタイル**
  - GitHub のダーク/ライトテーマに自動追従
- **折り畳み対応**
  - diff が collapsed 状態でもボタンが見えるか確認、必要なら対応
- **debounce**
  - MutationObserver の発火を 100ms 程度でdebounce

### 完了判定

10ファイル以上のPR、ダークモード、セッション切れのいずれでも破綻しない。

## Phase 3: 拡張(任意、痛みが出てから)

実用しはじめて「ここが欲しい」と思ったタイミングで追加。先回りしない。

- **インラインiframe版**: 新規タブじゃなく差分の直下に展開(クイズのインタラクション確認込み)
- **viewport切り替え**: モバイル表示/デスクトップ表示の切り替えUI
- **一括プレビュー**: PRヘッダに「変更された全HTMLを開く」ボタン
- **PR以外への拡張**: 通常のファイル閲覧画面(`/blob/`)にも同じボタンを生やす

## 検証ポイント(Phase 1 中にクリアする)

- 実際のPR画面のDOMでファイルヘッダのセレクタが安定して取れるか
- "View file" リンクの href から raw URL への置換が全パターンで動くか(日本語・スペース・特殊文字)
- Blob URL + 新規タブで教育資料のクイズJSがちゃんと動くか
- ファイルサイズが大きい(数百KB)HTMLでもタイムアウトせずに表示されるか

## 想定リスク

| リスク                           | 対策                                                    |
| -------------------------------- | ------------------------------------------------------- |
| GitHubのDOM構造変更              | 複数セレクタでfallback、属性ベース(`data-path`等)で取る |
| CSP制約                          | 新規タブ + Blob URL はほぼ制約を受けない(実験済み)      |
| `<base>`タグや絶対パス依存のHTML | 表示崩れが起きたらPhase 2で対策判断                     |
| 外部CDN依存のJS                  | 通常通りCORS/CSPに従うため、個別対応                    |

## 成果物

1. `github-pr-html-preview.user.js`(Violentmonkeyにインストール可能なuserscript)
2. リポジトリ内の `tools/userscripts/` 等に配置してgit管理
3. 使い方を短いREADMEで添える(将来のClaude Code改善依頼用)

## 次の一歩

**Phase 0〜1を一気にやる**。実際のPR画面のDOMを見てセレクタを確定するのが最重要。

### 準備する情報

1. 適当な .html ファイルを含むPRを1つ開く
2. DevToolsのElementsタブで、ファイルヘッダ要素(ファイル名・View fileボタンがある行)を選択
3. その要素の `outerHTML` を確認

これがあればDoiさんの環境で確実に動くMVPのスクリプトを一発で書ける。

exec
/bin/bash -lc "sed -n '1,220p' /workspace/README.md && printf '\\n---\\n' && sed -n '1,220p' /workspace/vite.config.ts && printf '\\n---\\n' && sed -n '1,220p' /workspace/tsconfig.app.json && printf '\\n---\\n' && sed -n '1,220p' /workspace/tsconfig.test.json" in /workspace
 succeeded in 0ms:
# chrome-ext-template
---
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

---
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "types": ["chrome", "vite/client"],
    "composite": true
  },
  "include": ["src"],
  "exclude": ["src/**/__tests__/*", "src/**/*.test.ts", "src/**/*.spec.ts", "src/test/**/*"]
}

---
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "types": ["chrome", "vite/client", "vitest", "node"],
    "composite": true
  },
  "include": ["src/**/*"]
}

codex
**指摘事項**

- 重大: 現行案は untrusted な PR 内 HTML/JS をそのまま実行する設計で、セキュリティ前提が不足しています。`Blob` を `window.open` で開く案と、特に `sandbox="allow-scripts allow-same-origin"` の iframe 案は、任意スクリプト実行を許す設計です。`window.open(blobUrl, '_blank')` も `noopener` がなく opener を残します。MVP の前に「静的プレビューに限定する」のか「専用の sandbox preview page で隔離して動的実行する」のかを明文化すべきです。参照: [.specs/001-html-preview/implementation-plan.md#L109](/workspace/.specs/001-html-preview/implementation-plan.md#L109), [.specs/001-html-preview/implementation-plan.md#L248](/workspace/.specs/001-html-preview/implementation-plan.md#L248), [.specs/001-html-preview/implementation-plan.md#L392](/workspace/.specs/001-html-preview/implementation-plan.md#L392), [.specs/001-html-preview/implementation-plan.md#L555](/workspace/.specs/001-html-preview/implementation-plan.md#L555)

- 重大: 相対パスの CSS/JS/画像をどう解決するかが未定義です。`Blob` で HTML 単体を開いても `./style.css` `./app.js` `img/foo.png` などは repo 上の raw を見に行かず、一般的な HTML は見た目も挙動も崩れます。計画では `<base>` 依存を低リスク扱いしていますが、むしろ通常ケースです。`<base href=".../raw/.../dir/">` の注入、または相対 URL rewrite を仕様に追加し、少なくとも CSS/JS/画像の相対参照をテスト対象に入れるべきです。参照: [.specs/001-html-preview/implementation-plan.md#L109](/workspace/.specs/001-html-preview/implementation-plan.md#L109), [.specs/001-html-preview/implementation-plan.md#L131](/workspace/.specs/001-html-preview/implementation-plan.md#L131), [.specs/001-html-preview/implementation-plan.md#L560](/workspace/.specs/001-html-preview/implementation-plan.md#L560)

- 高: `await fetch` の後に `window.open` する実装は、ユーザー操作の文脈を外れてポップアップブロックされる可能性があります。クリック直後に空タブか専用 preview page を同期的に開き、取得完了後に遷移させる形へ変更した方が実装可能性が高いです。参照: [.specs/001-html-preview/implementation-plan.md#L248](/workspace/.specs/001-html-preview/implementation-plan.md#L248)

- 高: `manifest.json` の `matches` を `/pull/*/files` に限定すると、GitHub の Turbo/PJAX 遷移で Files changed タブへ移ったケースで content script が注入されない可能性があります。`MutationObserver` では補えません。`https://github.com/*/pull/*` に広げて runtime でページ判定するか、GitHub の遷移イベントを考慮する必要があります。参照: [.specs/001-html-preview/implementation-plan.md#L156](/workspace/.specs/001-html-preview/implementation-plan.md#L156), [.specs/001-html-preview/implementation-plan.md#L261](/workspace/.specs/001-html-preview/implementation-plan.md#L261), [.specs/001-html-preview/implementation-plan.md#L449](/workspace/.specs/001-html-preview/implementation-plan.md#L449), [.specs/001-html-preview/implementation-plan.md#L569](/workspace/.specs/001-html-preview/implementation-plan.md#L569)

- 中: URL 変換仕様が曖昧で、一部は壊れます。`encodeURI` を URL 全体にかける方針だと、ファイル名に `#` や `?` を含む場合に正しく扱えません。また `/raw/{head-sha}` と `/raw/refs/heads/{branch}` が混在しており、fork PR や branch 名に `/` を含むケース、削除ファイルや rename 時の挙動も未定です。実際の `View file` の absolute `href` を唯一のソースにし、取得不能なファイルは明示的に非対応にする方がよいです。参照: [.specs/001-html-preview/implementation-plan.md#L214](/workspace/.specs/001-html-preview/implementation-plan.md#L214), [.specs/001-html-preview/implementation-plan.md#L223](/workspace/.specs/001-html-preview/implementation-plan.md#L223), [.specs/001-html-preview/implementation-plan.md#L227](/workspace/.specs/001-html-preview/implementation-plan.md#L227)

- 中: DOM セレクタ方針がまだ仮置きで、記述にも不整合があります。優先順位に `data-testid` があるのに selector 一覧には含まれておらず、`div[id^="diff-"]` はヘッダ検出として広すぎます。実 DOM の fixture を spec かテストに固定し、ヘッダ要素とファイルパス取得元を先に確定した方がよいです。参照: [.specs/001-html-preview/implementation-plan.md#L189](/workspace/.specs/001-html-preview/implementation-plan.md#L189), [.specs/001-html-preview/implementation-plan.md#L210](/workspace/.specs/001-html-preview/implementation-plan.md#L210)

**改善案**

- MVP を「安全な静的 preview」に寄せるなら、script を実行しない preview とし、相対 asset 解決だけ対応する。
- インタラクティブ実行が必須なら、`src/content/*` だけで閉じず、専用 preview page か sandbox page を追加する前提に計画を組み替える。
- `matches` は `/pull/*` に広げ、PR 画面内で Files changed かどうかを runtime 判定する。
- テストには `vi.useFakeTimers()` 前提を追加し、popup blocker 回避フロー、relative asset、delete/rename/fork PR を含める。

**補足**

ファイル分割と Vitest ベースのテスト方針自体は、現在の Vite/Vitest 構成には概ね整合しています。ただし上の 1 と 2 を反映するなら、現行のファイル構成では preview 用の専用ページを追加する前提にした方が全体アーキテクチャは素直です。
tokens used
45,757
**指摘事項**

- 重大: 現行案は untrusted な PR 内 HTML/JS をそのまま実行する設計で、セキュリティ前提が不足しています。`Blob` を `window.open` で開く案と、特に `sandbox="allow-scripts allow-same-origin"` の iframe 案は、任意スクリプト実行を許す設計です。`window.open(blobUrl, '_blank')` も `noopener` がなく opener を残します。MVP の前に「静的プレビューに限定する」のか「専用の sandbox preview page で隔離して動的実行する」のかを明文化すべきです。参照: [.specs/001-html-preview/implementation-plan.md#L109](/workspace/.specs/001-html-preview/implementation-plan.md#L109), [.specs/001-html-preview/implementation-plan.md#L248](/workspace/.specs/001-html-preview/implementation-plan.md#L248), [.specs/001-html-preview/implementation-plan.md#L392](/workspace/.specs/001-html-preview/implementation-plan.md#L392), [.specs/001-html-preview/implementation-plan.md#L555](/workspace/.specs/001-html-preview/implementation-plan.md#L555)

- 重大: 相対パスの CSS/JS/画像をどう解決するかが未定義です。`Blob` で HTML 単体を開いても `./style.css` `./app.js` `img/foo.png` などは repo 上の raw を見に行かず、一般的な HTML は見た目も挙動も崩れます。計画では `<base>` 依存を低リスク扱いしていますが、むしろ通常ケースです。`<base href=".../raw/.../dir/">` の注入、または相対 URL rewrite を仕様に追加し、少なくとも CSS/JS/画像の相対参照をテスト対象に入れるべきです。参照: [.specs/001-html-preview/implementation-plan.md#L109](/workspace/.specs/001-html-preview/implementation-plan.md#L109), [.specs/001-html-preview/implementation-plan.md#L131](/workspace/.specs/001-html-preview/implementation-plan.md#L131), [.specs/001-html-preview/implementation-plan.md#L560](/workspace/.specs/001-html-preview/implementation-plan.md#L560)

- 高: `await fetch` の後に `window.open` する実装は、ユーザー操作の文脈を外れてポップアップブロックされる可能性があります。クリック直後に空タブか専用 preview page を同期的に開き、取得完了後に遷移させる形へ変更した方が実装可能性が高いです。参照: [.specs/001-html-preview/implementation-plan.md#L248](/workspace/.specs/001-html-preview/implementation-plan.md#L248)

- 高: `manifest.json` の `matches` を `/pull/*/files` に限定すると、GitHub の Turbo/PJAX 遷移で Files changed タブへ移ったケースで content script が注入されない可能性があります。`MutationObserver` では補えません。`https://github.com/*/pull/*` に広げて runtime でページ判定するか、GitHub の遷移イベントを考慮する必要があります。参照: [.specs/001-html-preview/implementation-plan.md#L156](/workspace/.specs/001-html-preview/implementation-plan.md#L156), [.specs/001-html-preview/implementation-plan.md#L261](/workspace/.specs/001-html-preview/implementation-plan.md#L261), [.specs/001-html-preview/implementation-plan.md#L449](/workspace/.specs/001-html-preview/implementation-plan.md#L449), [.specs/001-html-preview/implementation-plan.md#L569](/workspace/.specs/001-html-preview/implementation-plan.md#L569)

- 中: URL 変換仕様が曖昧で、一部は壊れます。`encodeURI` を URL 全体にかける方針だと、ファイル名に `#` や `?` を含む場合に正しく扱えません。また `/raw/{head-sha}` と `/raw/refs/heads/{branch}` が混在しており、fork PR や branch 名に `/` を含むケース、削除ファイルや rename 時の挙動も未定です。実際の `View file` の absolute `href` を唯一のソースにし、取得不能なファイルは明示的に非対応にする方がよいです。参照: [.specs/001-html-preview/implementation-plan.md#L214](/workspace/.specs/001-html-preview/implementation-plan.md#L214), [.specs/001-html-preview/implementation-plan.md#L223](/workspace/.specs/001-html-preview/implementation-plan.md#L223), [.specs/001-html-preview/implementation-plan.md#L227](/workspace/.specs/001-html-preview/implementation-plan.md#L227)

- 中: DOM セレクタ方針がまだ仮置きで、記述にも不整合があります。優先順位に `data-testid` があるのに selector 一覧には含まれておらず、`div[id^="diff-"]` はヘッダ検出として広すぎます。実 DOM の fixture を spec かテストに固定し、ヘッダ要素とファイルパス取得元を先に確定した方がよいです。参照: [.specs/001-html-preview/implementation-plan.md#L189](/workspace/.specs/001-html-preview/implementation-plan.md#L189), [.specs/001-html-preview/implementation-plan.md#L210](/workspace/.specs/001-html-preview/implementation-plan.md#L210)

**改善案**

- MVP を「安全な静的 preview」に寄せるなら、script を実行しない preview とし、相対 asset 解決だけ対応する。
- インタラクティブ実行が必須なら、`src/content/*` だけで閉じず、専用 preview page か sandbox page を追加する前提に計画を組み替える。
- `matches` は `/pull/*` に広げ、PR 画面内で Files changed かどうかを runtime 判定する。
- テストには `vi.useFakeTimers()` 前提を追加し、popup blocker 回避フロー、relative asset、delete/rename/fork PR を含める。

**補足**

ファイル分割と Vitest ベースのテスト方針自体は、現在の Vite/Vitest 構成には概ね整合しています。ただし上の 1 と 2 を反映するなら、現行のファイル構成では preview 用の専用ページを追加する前提にした方が全体アーキテクチャは素直です。
