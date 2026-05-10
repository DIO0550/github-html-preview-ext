/**
 * Inline-bridge script generator. The script is injected into the user HTML
 * rendered inside the innermost (sandboxed `srcdoc`) iframe and reports the
 * document scroll height to its parent so the embedder can auto-fit the
 * outer iframe height.
 */

/**
 * Create the preview-bridge script as a string. The script reports
 * `document.documentElement.scrollHeight` via postMessage to the parent on
 * load and on subsequent body mutations. Must be safe under the security
 * sandbox (avoids any blocked APIs).
 * @returns JavaScript source code string
 */
export function createPreviewBridgeScript(): string {
  return `(function(){
  var pendingZoom = null;
  function postSize() {
    try {
      var h = document.documentElement ? document.documentElement.scrollHeight : 0;
      parent.postMessage({ type: 'preview-content-size', scrollHeight: h }, '*');
    } catch (e) {}
  }
  function applyPendingZoom() {
    if (pendingZoom === null || !document.body) return;
    try {
      document.body.style.zoom = String(pendingZoom / 100);
    } catch (e) {}
  }
  function startObserver() {
    try {
      if (typeof MutationObserver === 'undefined' || !document.body) return;
      new MutationObserver(postSize).observe(document.body, {
        childList: true, subtree: true, attributes: true
      });
    } catch (e) {}
  }
  window.addEventListener('message', function(e) {
    var d = e && e.data;
    if (d && d.type === 'preview-content-zoom' && typeof d.zoomPercent === 'number') {
      pendingZoom = d.zoomPercent;
      applyPendingZoom();
    }
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    applyPendingZoom();
    postSize();
    startObserver();
  } else {
    window.addEventListener('DOMContentLoaded', function(){ applyPendingZoom(); postSize(); startObserver(); });
  }
  window.addEventListener('load', function(){ applyPendingZoom(); postSize(); });
})();`;
}

/**
 * Inject the preview-bridge script into HTML at the beginning of `<head>`.
 * Mirrors the strategy used by `injectSecuritySandbox` so order is preserved
 * (sandbox runs first to lock down APIs, then the bridge runs).
 * @param html - The HTML string to inject into
 * @returns Modified HTML with the bridge script injected
 */
export function injectPreviewBridge(html: string): string {
  const script = `<script>${createPreviewBridgeScript()}</script>`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    const insertPos = html.indexOf(headMatch[0]) + headMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }
  const bodyMatch = html.match(/<body[^>]*>/i);
  if (bodyMatch) {
    const insertPos = html.indexOf(bodyMatch[0]);
    return html.slice(0, insertPos) + '<head>' + script + '</head>' + html.slice(insertPos);
  }
  return '<head>' + script + '</head>' + html;
}
