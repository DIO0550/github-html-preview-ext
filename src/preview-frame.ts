type RenderMessage = {
  type: 'preview-frame-render';
  html: string;
  enableJavaScript?: boolean;
};

type ZoomMessage = {
  type: 'preview-frame-zoom';
  zoomPercent: number;
};

type ContentZoomMessage = {
  type: 'preview-content-zoom';
  zoomPercent: number;
};

type ContentSizeMessage = {
  type: 'preview-content-size';
  scrollHeight: number;
};

type ReadyMessage = {
  type: 'preview-frame-ready';
};

type ResizeMessage = {
  type: 'preview-frame-resize';
  scrollHeight: number;
};

const READY_MESSAGE: ReadyMessage = { type: 'preview-frame-ready' };

/**
 * Type-guard for incoming render messages from the embedder.
 * @param data - Arbitrary value posted to this frame
 * @returns true if `data` is a render message
 */
function isRenderMessage(data: unknown): data is RenderMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return m.type === 'preview-frame-render' && typeof m.html === 'string';
}

/**
 * Type-guard for incoming zoom messages from the embedder.
 * @param data - Arbitrary value posted to this frame
 * @returns true if `data` is a zoom request
 */
function isZoomMessage(data: unknown): data is ZoomMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return m.type === 'preview-frame-zoom' && typeof m.zoomPercent === 'number';
}

/**
 * Type-guard for size messages emitted by the inner srcdoc iframe.
 * @param data - Arbitrary value posted to this frame
 * @returns true if `data` is a content-size message
 */
function isContentSizeMessage(data: unknown): data is ContentSizeMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return m.type === 'preview-content-size' && typeof m.scrollHeight === 'number';
}

const iframe = document.getElementById('content') as HTMLIFrameElement | null;
let lastZoomPercent: number | null = null;

/**
 * Forward the most recently-requested zoom level to the inner srcdoc iframe.
 * Called both when a new zoom message arrives and after every srcdoc reload
 * so the inner bridge script can re-apply CSS zoom on freshly-loaded content.
 */
function forwardZoom(): void {
  if (!iframe || lastZoomPercent === null) return;
  const message: ContentZoomMessage = {
    type: 'preview-content-zoom',
    zoomPercent: lastZoomPercent,
  };
  iframe.contentWindow?.postMessage(message, '*');
}

if (iframe) {
  iframe.addEventListener('load', forwardZoom);

  window.addEventListener('message', (event: MessageEvent) => {
    // Render messages flow from the embedder (the iframe parent).
    if (event.source === window.parent && isRenderMessage(event.data)) {
      const enableJavaScript = event.data.enableJavaScript !== false;
      iframe.setAttribute('sandbox', enableJavaScript ? 'allow-scripts' : '');
      iframe.srcdoc = event.data.html;
      return;
    }
    // Zoom messages also flow from the embedder. Remember the value so we
    // can replay it on every subsequent srcdoc reload.
    if (event.source === window.parent && isZoomMessage(event.data)) {
      lastZoomPercent = event.data.zoomPercent;
      forwardZoom();
      return;
    }
    // Size reports flow from the inner srcdoc iframe; forward to embedder.
    if (event.source === iframe.contentWindow && isContentSizeMessage(event.data)) {
      const resize: ResizeMessage = {
        type: 'preview-frame-resize',
        scrollHeight: event.data.scrollHeight,
      };
      window.parent.postMessage(resize, '*');
    }
  });
}

if (window.parent !== window) {
  window.parent.postMessage(READY_MESSAGE, '*');
}
