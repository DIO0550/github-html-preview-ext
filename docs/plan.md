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
