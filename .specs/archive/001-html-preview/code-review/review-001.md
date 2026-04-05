**Findings**
1. 重大: 新規タブプレビューの遷移先パスがビルド成果物と一致しておらず、MVP の主機能が壊れています。[src/content/html-fetcher.ts:35](/workspace/src/content/html-fetcher.ts#L35) では `preview.html` を開いていますが、ビルド入力は [vite.config.ts:12](/workspace/vite.config.ts#L12) の `src/preview.html` で、manifest の公開設定も [public/manifest.json:41](/workspace/public/manifest.json#L41) の `src/preview.html` です。実際に `pnpm build` の出力は `dist/src/preview.html` で、`dist/preview.html` は生成されません。改善案は、`chrome.runtime.getURL()`・`web_accessible_resources`・ビルド出力先を同じパスに統一することです。

2. 中: Inline/Panel の fetch 失敗時に未処理例外になり、計画にあるエラーハンドリングとセッション切れ通知が実装されていません。[src/content/preview-button.ts:88](/workspace/src/content/preview-button.ts#L88) と [src/content/preview-button.ts:94](/workspace/src/content/preview-button.ts#L94) は `fetchPreviewHtml(...).then(...)` のみで `catch` がなく、[src/content/html-fetcher.ts:20](/workspace/src/content/html-fetcher.ts#L20) は generic な `HTTP xxx` 例外しか返しません。一方でボタン状態更新ロジックは [src/content/preview-button.ts:56](/workspace/src/content/preview-button.ts#L56) にあるものの、本番コードから使われていません。改善案は、各クリック処理を共通 async ヘルパーに寄せて `loading/error/idle` を適用し、`response.status` と `response.url` で 401/403 やログイン画面リダイレクトを判定して明示メッセージを出すことです。

3. 中: Phase 3 の viewport 切替はモジュールだけ存在し、実際の UI に接続されていません。[src/content/viewport-toggle.ts:23](/workspace/src/content/viewport-toggle.ts#L23) に切替 UI 実装はありますが、インライン生成側 [src/content/inline-preview.ts:9](/workspace/src/content/inline-preview.ts#L9) とサイドパネル側 [src/content/side-panel.ts:72](/workspace/src/content/side-panel.ts#L72) のどちらからも使われていません。DoD の「Desktop/Tablet/Mobile の viewport 切替が動作する」は未達です。改善案は、両プレビュー生成箇所で iframe の直前に toggle を挿入することです。

4. 中: 一括プレビューは 1 ファイルでも fetch に失敗すると残りを処理できません。[src/content/batch-preview.ts:23](/workspace/src/content/batch-preview.ts#L23) から [src/content/batch-preview.ts:32](/workspace/src/content/batch-preview.ts#L32) では逐次 `await` しており、例外を握っていないため最初の失敗で全体が中断します。さらに既存プレビューに対しては [src/content/inline-preview.ts:44](/workspace/src/content/inline-preview.ts#L44) の toggle 動作になるため、再実行時に「全部開く」ではなく「閉じる」ケースが出ます。改善案は `Promise.allSettled` または per-file `try/catch` にして、batch 実行時は「未展開なら開く」に寄せることです。

**補足**
`pnpm test` は 96 件すべて成功し、`pnpm build` も通りました。ただし、テストはビルド後の拡張パス整合性と、失敗系 UI の欠落を拾えていません。

セキュリティ面では、sandboxed iframe と `textContent` 利用が中心で、明確な XSS/インジェクション脆弱性は見当たりませんでした。パフォーマンス面も致命的ではありませんが、一括プレビューの逐次 fetch は PR 内 HTML 数が多いと体感遅延になりやすいです。
