type RenderMessage = {
  type: 'preview-frame-render';
  html: string;
  enableJavaScript?: boolean;
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

if (iframe) {
  window.addEventListener('message', (event: MessageEvent) => {
    // Render messages flow from the embedder (the iframe parent).
    if (event.source === window.parent && isRenderMessage(event.data)) {
      const enableJavaScript = event.data.enableJavaScript !== false;
      iframe.setAttribute('sandbox', enableJavaScript ? 'allow-scripts' : '');
      iframe.srcdoc = event.data.html;
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
