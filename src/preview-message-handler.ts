type PreviewMessage = {
  type: string;
  id: string;
  html: string | null;
  error: string | null;
  enableJavaScript?: boolean;
};

type RenderMessage = {
  type: 'preview-frame-render';
  html: string;
  enableJavaScript: boolean;
};

let pendingMessage: RenderMessage | null = null;
let frameReady = false;

/**
 * Listen at module load for the `preview-frame-ready` signal posted by the
 * embedded sandbox page. When ready arrives, flush any queued render message.
 * Module-level state (`frameReady`, `pendingMessage`) is reset by tests via
 * `resetPreviewFrameState`.
 */
window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type?: string } | null;
  if (!data || data.type !== 'preview-frame-ready') return;
  frameReady = true;
  const iframe = document.getElementById('preview') as HTMLIFrameElement | null;
  if (iframe && pendingMessage) {
    iframe.contentWindow?.postMessage(pendingMessage, '*');
    pendingMessage = null;
  }
});

/**
 * Forward a render message to the embedded preview-frame iframe. If the
 * sandbox page has not yet signalled ready, the message is queued and sent
 * on receipt of `preview-frame-ready`.
 * @param iframe - The outer iframe whose contentWindow hosts preview-frame.html
 * @param html - HTML body to render
 * @param enableJavaScript - Whether the inner sandbox should allow scripts
 */
function postRender(iframe: HTMLIFrameElement, html: string, enableJavaScript: boolean): void {
  const message: RenderMessage = {
    type: 'preview-frame-render',
    html,
    enableJavaScript,
  };
  if (frameReady) {
    iframe.contentWindow?.postMessage(message, '*');
  } else {
    pendingMessage = message;
  }
}

/**
 * Reset internal ready/queue state. Intended for tests; resets the cached
 * signal that the preview-frame is loaded so each test starts fresh.
 */
export function resetPreviewFrameState(): void {
  pendingMessage = null;
  frameReady = false;
}

/**
 * Handle a preview message by forwarding HTML to the embedded preview-frame
 * sandbox iframe via postMessage, or showing an error message in-place.
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
      const enableJS = message.enableJavaScript !== false;
      postRender(iframe, message.html, enableJS);
    }
  } else if (message.error) {
    if (loading) loading.style.display = 'none';
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = message.error;
    }
  }
}
