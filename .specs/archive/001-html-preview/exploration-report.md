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
    "noUnusedParameters": true,
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

`strict: true`, `noUnusedLocals`, `noUnusedParameters` が有効。DOM 型定義が含まれている。`@types/chrome` は `tsconfig.app.json` の `types: ["chrome", "vite/client"]` で指定。

### src/options/App.tsx -- オプションページ (参考)

```tsx
function App() {
  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold text-foreground">Extension Options</h1>
      <p className="mt-4 text-muted-foreground">Configure your extension settings here.</p>
    </div>
  );
}
export default App;
```

Tailwind CSS のカスタムデザイントークンを使用。Phase 1 では変更不要。

### package.json -- 依存関係 (関連部分)

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc && vite build && vite build -c vite.content.config.ts",
    "test": "vitest"
  },
  "dependencies": {
    "react": "^19.2.3",
    "react-dom": "^19.2.3"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "vitest": "^4.0.16",
    "happy-dom": "^20.0.10",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.0",
    "vite": "^7.3.0",
    "typescript": "^5.4.5"
  }
}
```

### docs/plan.md -- 骨格コード (重要部分抜粋)

plan.md にはViolentmonkey版の骨格コードが含まれており、Chrome拡張に適応して使用する:

```javascript
const addPreviewButtons = () => {
  document
    .querySelectorAll('.file-header, [data-testid="file-header"]')
    .forEach((header) => {
      const path = header.dataset.path || header.getAttribute("data-tagsearch-path");
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
```

raw URL 形式: `github.com/{owner}/{repo}/raw/refs/heads/{branch}/{path}` (セッションクッキー経由で認証 -> `raw.githubusercontent.com` にリダイレクト)

## 3. 技術的制約・リスク

### IIFE ビルド制約
- コンテンツスクリプトは `format: 'iife'` で出力される必要がある
- `src/content.ts` から他モジュールを `import` しても Vite がバンドルするため、モジュール分割は可能
- ただし動的 `import()` は使用不可

### Manifest V3 制約
- `background.service_worker` は ES モジュール (`"type": "module"`) として設定済み
- コンテンツスクリプトからバックグラウンドへのメッセージングは `chrome.runtime.sendMessage` を使用
- `fetch` はコンテンツスクリプトのコンテキスト (github.com オリジン) で実行されるため、セッションクッキーが自動送信される (`credentials: 'include'`)
- コンテンツスクリプトの DOM とページの JS コンテキストは分離されている

### GitHub DOM 依存リスク
- GitHub の DOM 構造は予告なく変更される可能性がある
- hearing-notes と plan.md では `.file-header`, `[data-testid="file-header"]`, `data-path` 属性等を候補セレクタとして挙げている
- 複数セレクタによるフォールバック戦略が推奨されている
- DOM セレクタの確定は実際の PR ページでの DevTools 調査が最重要

### URL 構築リスク
- raw URL 形式: `/blob/{sha}/{path}` -> `/raw/{sha}/{path}` に置換
- 日本語・スペース・特殊文字を含むファイルパスへの対応が必要
- GitHub のリダイレクト挙動が変わる可能性がある

### Blob URL とメモリ
- `URL.createObjectURL` で生成した Blob URL は明示的に `revokeObjectURL` しないとメモリリーク
- Phase 2 で対応予定 (タイマーベースの解放)

## 4. 変更影響範囲

### 既存ファイルの変更

| ファイル | 変更内容 | 影響度 |
|---------|---------|--------|
| `src/content.ts` | 全面書き換え: Preview ボタン挿入、MutationObserver、fetch + Blob URL | 大 (主要実装) |
| `public/manifest.json` | `name`, `description`, `matches` の更新 | 小 |
| `src/test/setup.ts` | 必要に応じて Chrome API モック追加 (Phase 2以降) | 小 |

### 新規ファイル候補

テスタビリティのためにモジュール分割する場合:

| ファイル | 用途 |
|---------|------|
| `src/html-preview/detect.ts` | HTML ファイル検出、DOM セレクタ |
| `src/html-preview/url.ts` | URL 変換 (/blob/ -> /raw/) |
| `src/html-preview/button.ts` | Preview ボタン生成・挿入 |
| `src/html-preview/preview.ts` | fetch + Blob URL + 新規タブ表示 |
| `src/html-preview/observer.ts` | MutationObserver + debounce |
| `src/html-preview/*.test.ts` | 各モジュールのテスト |

Vite の IIFE ビルドが import をバンドルするため、モジュール分割してもコンテンツスクリプトの制約に抵触しない。TDD で進める場合はモジュール分割が望ましい。

### 変更不要なファイル

- `src/background.ts` -- Phase 1 では拡張不要
- `src/options/` -- Phase 1 では変更不要
- `vite.config.ts` -- 設定変更不要
- `vite.content.config.ts` -- 設定変更不要 (content.ts からの import はそのままバンドルされる)
- `vitest.config.ts` -- 設定変更不要

## 5. テストインフラストラクチャ

### 現状
- **テストランナー**: Vitest 4.0.16 (`pnpm test` で実行)
- **DOM環境**: happy-dom 20.0.10 (MutationObserver サポート済み)
- **セットアップ**: `src/test/setup.ts` で `chrome` グローバルをモック
- **アサーション拡張**: `@testing-library/jest-dom` (toBeInTheDocument 等)
- **React テスト**: `@testing-library/react` (render, screen 等)
- **既存テスト数**: 0件 (インフラのみ構築済み)
- **テストパターン**: `src/**/*.{test,spec}.{ts,tsx}` (ソースと並置)
- **グローバル**: `globals: true` (import 不要で `it`, `expect`, `describe` が使える)

### テスト戦略 (TDD: Red-Green-Refactor)

hearing-notes で TDD が明記されているため、以下の順序でテストファーストで進める:

1. **純粋関数のユニットテスト** (DOM 非依存)
   - URL 変換: `/blob/` -> `/raw/` 置換
   - HTML ファイル検出: パス末尾 `.html` 判定
   - debounce ユーティリティ

2. **DOM 操作のユニットテスト** (happy-dom)
   - ファイルヘッダ要素の検出
   - Preview ボタン生成・挿入
   - 重複防止チェック (`.html-preview-btn` の存在確認)

3. **統合テスト** (モック使用)
   - MutationObserver による動的ボタン挿入
   - fetch -> Blob -> window.open のフロー

### テスト用モック (追加が必要になるもの)

```typescript
// fetch モック
vi.stubGlobal('fetch', vi.fn());

// Blob URL モック
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});

// window.open モック
vi.stubGlobal('open', vi.fn());
```

## 6. 実装への示唆

### 推奨アーキテクチャ

ロジックを小さな純粋関数に分離し、TDD でテスタビリティを確保:

```
src/content.ts (エントリポイント: IIFE にバンドルされる)
  ├── import { findHtmlFileHeaders } from './html-preview/detect'
  ├── import { convertToRawUrl } from './html-preview/url'
  ├── import { createPreviewButton } from './html-preview/button'
  ├── import { fetchAndPreview } from './html-preview/preview'
  └── import { observeDom } from './html-preview/observer'
```

### manifest.json の推奨変更

```json
{
  "name": "GitHub PR HTML Preview",
  "description": "Preview HTML files directly in GitHub PR Files changed tab",
  "content_scripts": [{
    "matches": ["https://github.com/*/pull/*/files"],
    "js": ["assets/content.js"],
    "run_at": "document_end"
  }]
}
```

`permissions` に `activeTab` は不要 -- fetch はコンテンツスクリプトの github.com オリジンで実行されるため、現行の `storage` のみで十分。

### Phase 1 MVP の実装順序

1. `url.ts` + テスト: URL 変換ロジック (純粋関数、最もテストしやすい)
2. `detect.ts` + テスト: HTML ファイル検出 + DOM セレクタ
3. `button.ts` + テスト: Preview ボタン生成・挿入
4. `preview.ts` + テスト: fetch + Blob URL + window.open
5. `observer.ts` + テスト: MutationObserver (debounce 含む)
6. `content.ts` 統合: 上記モジュールを組み合わせてエントリポイントを構成
7. `manifest.json` 更新: matches を GitHub PR URL に限定

### docs/plan.md からの骨格コード活用

plan.md の骨格コードは Chrome 拡張用に以下を適応:
- `@match` メタデータ -> `manifest.json` の `matches` に移行
- `@grant none` -> Manifest V3 のコンテンツスクリプトパーミッションモデルに移行
- グローバル関数 -> TypeScript モジュールに分割
- `window.open` はコンテンツスクリプトから直接呼び出し可能 (chrome.tabs.create 不要)

## 7. 探索メトリクス

| 項目 | 値 |
|------|-----|
| Read したファイル数 | 20 |
| 主要コードスニペット数 | 11 (content.ts, background.ts, manifest.json, vite.config.ts, vite.content.config.ts, vitest.config.ts, setup.ts, tsconfig.base.json, App.tsx, package.json, plan.md骨格コード) |
| テストファイル数 (既存) | 0 |
| Glob 検索 | 1回 (既存テストファイルの存在確認 -> 0件) |
| ディレクトリ探索 | 1回 (find による全体構造把握) |
| 逆引き検索 (Grep) | 未実施 (全ファイルがスケルトン状態のため不要) |
| 探索カバレッジ | 全ソースファイル (6件) + 全設定ファイル (10件) + ドキュメント (2件) + hearing-notes を網羅 |
