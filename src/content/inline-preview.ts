import { createViewportToggle } from './viewport-toggle';
import { createZoomControl } from './zoom-control';

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

const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true, // required: body.style.zoom mutations arrive as attribute changes
};

/**
 * Module-scope map of iframe → active MutationObserver. Ensures each iframe
 * has at most one observer, so load re-fires (srcdoc swap) can disconnect the
 * previous observer before re-attaching to the new body. See implementation
 * plan §4.2 and review-004 指摘 #1.
 */
const iframeObservers = new WeakMap<HTMLIFrameElement, MutationObserver>();

/**
 * Auto-resize an iframe's outer height so it matches content scrollHeight
 * normalized to the 100% baseline (i.e. `scrollHeight / scale`). Height
 * recalculation triggers are:
 *   (A) iframe `load` (initial and srcdoc-triggered re-loads)
 *   (B) MutationObserver firing on contentDocument.body
 * `applyZoom` itself never calls syncHeight directly — it mutates
 * `body.style.zoom`, and that attribute mutation reaches the observer, which
 * then calls syncHeight. This keeps the iframe outer frame fixed regardless
 * of the zoom level. Must be registered **after** zoom-control's persistent
 * load listener so that on each load, zoom is reapplied before syncHeight
 * reads body.style.zoom.
 * @param iframe - The iframe element to auto-resize
 */
function setupAutoResize(iframe: HTMLIFrameElement): void {
  const syncHeight = (): void => {
    try {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) return;
      const raw = doc.documentElement.scrollHeight;
      // `raw === 0` is a valid result — write '0px' to avoid stale values.
      const rawNormalized = raw < 0 ? 0 : raw;
      const scaleStr = doc.body?.style.zoom || iframe.dataset.htmlPreviewZoom || '1';
      const scale = Number(scaleStr) || 1;
      const base = rawNormalized / scale;
      iframe.style.height = `${base}px`;
      iframe.dataset.htmlPreviewBaseHeight = String(base);
    } catch {
      // cross-origin: contentDocument getter / access may throw
    }
  };

  iframe.addEventListener('load', () => {
    // Disconnect the previous observer **before** touching contentDocument,
    // so that a subsequent load firing with a throwing getter still cleans
    // up the old observer. (review-006 指摘 #1)
    const prev = iframeObservers.get(iframe);
    if (prev) {
      prev.disconnect();
      iframeObservers.delete(iframe);
    }

    // zoom-control's persistent load listener is registered before this one
    // (via the call order in createInlinePreview), so body.style.zoom has
    // already been re-applied by the time we run.
    syncHeight();
    try {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      const observer = new MutationObserver(syncHeight);
      observer.observe(doc.body, OBSERVER_OPTIONS);
      iframeObservers.set(iframe, observer);
    } catch {
      // cross-origin
    }
  });
}

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
 * Create an inline iframe preview, replacing the code display area.
 * Call order inside this function is significant: `createZoomControl` must
 * run before `setupAutoResize`, so that the zoom-control persistent load
 * listener is registered first and re-applies body.style.zoom before the
 * inline-preview load listener runs syncHeight. (review-003 指摘 #1)
 * @param container - The DOM element containing the code
 * @param html - HTML content to render (should already have `<base>` injected)
 * @param defaultZoom - Initial zoom percentage (default 100)
 * @returns The created iframe element
 */
export function createInlinePreview(
  container: Element,
  html: string,
  defaultZoom: number = 100
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
  iframe.srcdoc = html;
  iframe.style.cssText = `
    width: 100%;
    height: 80vh;
    border: none;
  `;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 4px 0;';
  toolbar.appendChild(createViewportToggle(iframe));
  // Order matters: createZoomControl registers the persistent load listener
  // that reapplies body.style.zoom; setupAutoResize must be registered after
  // so its load listener runs after zoom reapplication.
  toolbar.appendChild(createZoomControl(iframe, defaultZoom));
  setupAutoResize(iframe);

  wrapper.appendChild(toolbar);
  wrapper.appendChild(iframe);

  // Hide the code container and insert preview in its place
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
 * Toggle inline preview visibility. Creates the preview on first call,
 * toggles between code and preview on subsequent calls.
 * @param container - The DOM element containing the preview
 * @param html - HTML content to render
 * @param defaultZoom - Initial zoom percentage (default 100)
 */
export function toggleInlinePreview(container: Element, html: string, defaultZoom: number = 100): void {
  const existing = container.querySelector(`.${INLINE_WRAPPER_CLASS}`) as HTMLElement | null;
  if (existing) {
    const isHidden = existing.style.display === 'none';
    existing.style.display = isHidden ? '' : 'none';

    // Toggle code container visibility inversely
    const codeContainer = container.querySelector(`.${HIDDEN_MARKER}`) as HTMLElement | null;
    if (codeContainer) {
      codeContainer.style.display = isHidden ? 'none' : '';
    }
    return;
  }
  createInlinePreview(container, html, defaultZoom);
}

/**
 * Remove the inline preview from a container, restoring code display.
 * Also disconnects and removes any MutationObserver previously registered
 * on the iframe via setupAutoResize (review-005 指摘 #1).
 * @param container - The DOM element containing the preview
 */
export function removeInlinePreview(container: Element): void {
  const wrapper = container.querySelector(`.${INLINE_WRAPPER_CLASS}`);
  if (!wrapper) return;

  const iframe = wrapper.querySelector('iframe');
  if (iframe) {
    const observer = iframeObservers.get(iframe);
    if (observer) {
      observer.disconnect();
      iframeObservers.delete(iframe);
    }
    iframe.srcdoc = '';
  }

  wrapper.remove();

  // Restore code container
  const codeContainer = container.querySelector(`.${HIDDEN_MARKER}`) as HTMLElement | null;
  if (codeContainer) {
    codeContainer.classList.remove(HIDDEN_MARKER);
    codeContainer.style.display = '';
  }
}
