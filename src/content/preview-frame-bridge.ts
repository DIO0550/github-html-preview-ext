type RenderRequest = {
  html: string;
  enableJavaScript: boolean;
};

type RenderMessage = {
  type: 'preview-frame-render';
  html: string;
  enableJavaScript: boolean;
};

type ZoomMessage = {
  type: 'preview-frame-zoom';
  zoomPercent: number;
};

type RenderFn = (html: string, enableJavaScript: boolean) => void;
type ZoomFn = (zoomPercent: number) => void;
type DestroyFn = () => void;
type ResizeCallback = (scrollHeight: number) => void;

export type PreviewFrameBridge = {
  render: RenderFn;
  setZoom: ZoomFn;
  destroy: DestroyFn;
};

/**
 * Set up a postMessage bridge to a preview-frame iframe. Handles the
 * `preview-frame-ready` handshake (queueing render until ready) and forwards
 * `preview-frame-resize` notifications from the inner sandbox iframe to the
 * supplied callback so the embedder can auto-fit the iframe height.
 *
 * Zoom requests are sent via `preview-frame-zoom` and are remembered so a
 * subsequent render can re-apply them after the inner srcdoc reloads —
 * preview-frame.ts handles the persistence on the receiving side.
 * @param iframe - iframe whose `src` points at preview-frame.html
 * @param onResize - Optional callback invoked with the inner content's scrollHeight
 * @returns Object with `render(html, enableJavaScript)`, `setZoom(percent)` and `destroy()`
 */
export function setupPreviewFrameBridge(
  iframe: HTMLIFrameElement,
  onResize?: ResizeCallback
): PreviewFrameBridge {
  let pendingRender: RenderRequest | null = null;
  let pendingZoom: number | null = null;
  let ready = false;

  /** Send any queued render message to the iframe and clear the queue. */
  const flushRender = (): void => {
    if (!pendingRender) return;
    const message: RenderMessage = {
      type: 'preview-frame-render',
      html: pendingRender.html,
      enableJavaScript: pendingRender.enableJavaScript,
    };
    iframe.contentWindow?.postMessage(message, '*');
    pendingRender = null;
  };

  /**
   * Send the current zoom level (if any) to preview-frame.html. Unlike
   * `flushRender`, this leaves `pendingZoom` set so future renders that
   * cause an inner-iframe reload can re-apply the same zoom.
   */
  const sendZoom = (): void => {
    if (pendingZoom === null) return;
    const message: ZoomMessage = {
      type: 'preview-frame-zoom',
      zoomPercent: pendingZoom,
    };
    iframe.contentWindow?.postMessage(message, '*');
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
      flushRender();
      sendZoom();
      return;
    }
    if (data.type === 'preview-frame-resize' && typeof data.scrollHeight === 'number' && onResize) {
      onResize(data.scrollHeight);
    }
  };
  window.addEventListener('message', handler);

  return {
    render(html: string, enableJavaScript: boolean): void {
      pendingRender = { html, enableJavaScript };
      if (ready) flushRender();
    },
    setZoom(zoomPercent: number): void {
      pendingZoom = zoomPercent;
      if (ready) sendZoom();
    },
    destroy(): void {
      window.removeEventListener('message', handler);
      pendingRender = null;
      pendingZoom = null;
    },
  };
}
