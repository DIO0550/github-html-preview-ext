type RenderRequest = {
  html: string;
  enableJavaScript: boolean;
};

type RenderMessage = {
  type: 'preview-frame-render';
  html: string;
  enableJavaScript: boolean;
};

type RenderFn = (html: string, enableJavaScript: boolean) => void;
type DestroyFn = () => void;
type ResizeCallback = (scrollHeight: number) => void;

export type PreviewFrameBridge = {
  render: RenderFn;
  destroy: DestroyFn;
};

/**
 * Set up a postMessage bridge to a preview-frame iframe. Handles the
 * `preview-frame-ready` handshake (queueing render until ready) and forwards
 * `preview-frame-resize` notifications from the inner sandbox iframe to the
 * supplied callback so the embedder can auto-fit the iframe height.
 * @param iframe - iframe whose `src` points at preview-frame.html
 * @param onResize - Optional callback invoked with the inner content's scrollHeight
 * @returns Object with `render(html, enableJavaScript)` and `destroy()`
 */
export function setupPreviewFrameBridge(
  iframe: HTMLIFrameElement,
  onResize?: ResizeCallback
): PreviewFrameBridge {
  let pending: RenderRequest | null = null;
  let ready = false;

  /** Send any queued render message to the iframe and clear the queue. */
  const flush = (): void => {
    if (!pending) return;
    const message: RenderMessage = {
      type: 'preview-frame-render',
      html: pending.html,
      enableJavaScript: pending.enableJavaScript,
    };
    iframe.contentWindow?.postMessage(message, '*');
    pending = null;
  };

  /**
   * Window message listener for ready/resize signals from this iframe.
   * @param event - The MessageEvent posted by the iframe contentWindow
   */
  const handler = (event: MessageEvent): void => {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as { type?: string; scrollHeight?: number } | null;
    if (!data) return;
    if (data.type === 'preview-frame-ready') {
      ready = true;
      flush();
      return;
    }
    if (data.type === 'preview-frame-resize' && typeof data.scrollHeight === 'number' && onResize) {
      onResize(data.scrollHeight);
    }
  };
  window.addEventListener('message', handler);

  return {
    render(html: string, enableJavaScript: boolean): void {
      pending = { html, enableJavaScript };
      if (ready) flush();
    },
    destroy(): void {
      window.removeEventListener('message', handler);
      pending = null;
    },
  };
}
