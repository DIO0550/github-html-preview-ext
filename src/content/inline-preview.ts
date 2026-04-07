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

/**
 * Auto-resize an iframe's height to match its content, eliminating internal scroll.
 * Uses contentDocument.scrollHeight read via allow-same-origin sandbox.
 * Also observes DOM mutations inside the iframe to handle dynamic content.
 * @param iframe - The iframe element to auto-resize
 */
function setupAutoResize(iframe: HTMLIFrameElement): void {
  const syncHeight = () => {
    try {
      const doc = iframe.contentDocument;
      if (doc?.documentElement) {
        const h = doc.documentElement.scrollHeight;
        if (h > 0) {
          iframe.style.height = `${h}px`;
        }
      }
    } catch {
      // Cross-origin access denied — fall back to initial fixed height
    }
  };

  iframe.addEventListener('load', () => {
    syncHeight();
    // Watch for dynamic content changes inside the iframe
    try {
      const doc = iframe.contentDocument;
      if (doc?.body) {
        new MutationObserver(syncHeight).observe(doc.body, {
          childList: true, subtree: true, attributes: true,
        });
      }
    } catch {
      // ignore
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
  setupAutoResize(iframe);

  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 4px 0;';
  toolbar.appendChild(createViewportToggle(iframe));
  toolbar.appendChild(createZoomControl(iframe, defaultZoom));

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
 * @param container - The DOM element containing the preview
 */
export function removeInlinePreview(container: Element): void {
  const wrapper = container.querySelector(`.${INLINE_WRAPPER_CLASS}`);
  if (!wrapper) return;

  const iframe = wrapper.querySelector('iframe');
  if (iframe) iframe.srcdoc = '';

  wrapper.remove();

  // Restore code container
  const codeContainer = container.querySelector(`.${HIDDEN_MARKER}`) as HTMLElement | null;
  if (codeContainer) {
    codeContainer.classList.remove(HIDDEN_MARKER);
    codeContainer.style.display = '';
  }
}
