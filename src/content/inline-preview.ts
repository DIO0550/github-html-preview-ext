import { createViewportToggle } from './viewport-toggle';
import { setupPreviewFrameBridge, type PreviewFrameBridge } from './preview-frame-bridge';

const INLINE_WRAPPER_CLASS = 'html-preview-inline';
const HIDDEN_MARKER = 'html-preview-hidden-code';

// Selectors for GitHub's code display containers (blob page & PR diff)
const CODE_CONTAINER_SELECTORS = [
  '[class*="CodeBlob-module"]',
  '[class*="BlobContent-module"]',
  '.js-blob-code-container',
  '.blob-code-content',
  '.js-file-content',
  '.diff-table',
  'table[data-diff-anchor]',
] as const;

const iframeBridges = new WeakMap<HTMLIFrameElement, PreviewFrameBridge>();

/**
 * Find the code display container within a parent element.
 * @param container - Parent element to search within
 * @returns The code container element, or null
 */
function findCodeContainer(container: Element): HTMLElement | null {
  for (const selector of CODE_CONTAINER_SELECTORS) {
    const el = container.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

/**
 * Create an inline iframe preview, replacing the code display area. The
 * iframe loads the manifest-declared sandbox page `preview-frame.html` and
 * receives the HTML body via postMessage. This avoids GitHub's CSP blocking
 * inline scripts inside the previewed HTML and keeps the rendered content
 * isolated from both the GitHub page and the extension's privileged origin.
 * @param container - The DOM element containing the code
 * @param html - HTML content to render (should already have `<base>` injected)
 * @param _defaultZoom - Reserved for future zoom support via postMessage bridge
 * @param enableJavaScript - Whether to allow script execution in the iframe (default true)
 * @returns The created iframe element
 */
export function createInlinePreview(
  container: Element,
  html: string,
  _defaultZoom: number = 100,
  enableJavaScript: boolean = true
): HTMLIFrameElement {
  const wrapper = document.createElement('div');
  wrapper.className = INLINE_WRAPPER_CLASS;
  wrapper.style.cssText = `
    border: 1px solid var(--color-border-default);
    border-radius: 6px;
    margin: 8px 0;
    overflow: auto;
  `;

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('src/preview-frame.html');
  iframe.style.cssText = `
    width: 100%;
    height: 80vh;
    border: none;
  `;

  const bridge = setupPreviewFrameBridge(iframe, (scrollHeight) => {
    iframe.style.height = `${scrollHeight}px`;
  });
  iframeBridges.set(iframe, bridge);
  bridge.render(html, enableJavaScript);

  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 4px 0;';
  toolbar.appendChild(createViewportToggle(iframe));

  wrapper.appendChild(toolbar);
  wrapper.appendChild(iframe);

  const codeContainer = findCodeContainer(container);
  if (codeContainer) {
    codeContainer.classList.add(HIDDEN_MARKER);
    codeContainer.style.display = 'none';
    codeContainer.insertAdjacentElement('afterend', wrapper);
  } else {
    container.appendChild(wrapper);
  }

  return iframe;
}

/**
 * Re-render an existing inline preview's iframe with new HTML.
 * @param container - The DOM element containing the preview
 * @param html - New HTML content to render
 * @param enableJavaScript - Whether to allow script execution (default true)
 * @returns `true` if the existing wrapper was updated, `false` when no
 *          preview wrapper/iframe/bridge was found (caller should fall back
 *          to `createInlinePreview`).
 */
export function updateInlinePreviewContent(container: Element, html: string, enableJavaScript: boolean = true): boolean {
  const wrapper = container.querySelector(`.${INLINE_WRAPPER_CLASS}`);
  if (!wrapper) return false;
  const iframe = wrapper.querySelector('iframe') as HTMLIFrameElement | null;
  if (!iframe) return false;
  const bridge = iframeBridges.get(iframe);
  if (!bridge) return false;
  bridge.render(html, enableJavaScript);
  return true;
}

/**
 * Toggle inline preview visibility. Creates the preview on first call,
 * toggles between code and preview on subsequent calls.
 * @param container - The DOM element containing the preview
 * @param html - HTML content to render
 * @param defaultZoom - Reserved for future zoom support
 * @param enableJavaScript - Whether to allow script execution (default true)
 */
export function toggleInlinePreview(container: Element, html: string, defaultZoom: number = 100, enableJavaScript: boolean = true): void {
  const existing = container.querySelector(`.${INLINE_WRAPPER_CLASS}`) as HTMLElement | null;
  if (existing) {
    const isHidden = existing.style.display === 'none';
    existing.style.display = isHidden ? '' : 'none';

    const codeContainer = container.querySelector(`.${HIDDEN_MARKER}`) as HTMLElement | null;
    if (codeContainer) {
      codeContainer.style.display = isHidden ? 'none' : '';
    }
    return;
  }
  createInlinePreview(container, html, defaultZoom, enableJavaScript);
}

/**
 * Remove the inline preview from a container, restoring code display. Tears
 * down the postMessage bridge attached to the iframe.
 * @param container - The DOM element containing the preview
 */
export function removeInlinePreview(container: Element): void {
  const wrapper = container.querySelector(`.${INLINE_WRAPPER_CLASS}`);
  if (!wrapper) return;

  const iframe = wrapper.querySelector('iframe');
  if (iframe) {
    const bridge = iframeBridges.get(iframe);
    if (bridge) {
      bridge.destroy();
      iframeBridges.delete(iframe);
    }
  }

  wrapper.remove();

  const codeContainer = container.querySelector(`.${HIDDEN_MARKER}`) as HTMLElement | null;
  if (codeContainer) {
    codeContainer.classList.remove(HIDDEN_MARKER);
    codeContainer.style.display = '';
  }
}
