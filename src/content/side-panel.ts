import { createViewportToggle } from './viewport-toggle';
import { createZoomControl } from './zoom-control';
import { getCachedSettings } from './settings';

const PANEL_ID = 'html-preview-panel';
const PANEL_IFRAME_ID = 'html-preview-panel-iframe';
const PANEL_CLOSE_ID = 'html-preview-panel-close';
const DEFAULT_WIDTH_PCT = 40;
const MIN_WIDTH_PCT = 15;
const MAX_WIDTH_PCT = 85;

/**
 * Create a fixed side panel on the right of the page with a resize handle,
 * header, and sandboxed iframe.
 * @returns The created panel element
 */
export function createSidePanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: ${DEFAULT_WIDTH_PCT}%;
    height: 100vh;
    background: var(--color-canvas-default, #fff);
    border-left: 1px solid var(--color-border-default, #d0d7de);
    z-index: 100;
    display: flex;
    flex-direction: column;
    box-shadow: -2px 0 8px rgba(0,0,0,0.1);
  `;

  // Resize handle — wider hit area for easier grabbing
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = `
    position: absolute;
    left: -3px;
    top: 0;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 101;
  `;
  // Visual indicator on hover
  resizeHandle.addEventListener('mouseenter', () => {
    resizeHandle.style.background = 'var(--color-accent-fg, #0969da)';
    resizeHandle.style.opacity = '0.4';
  });
  resizeHandle.addEventListener('mouseleave', () => {
    resizeHandle.style.background = '';
    resizeHandle.style.opacity = '';
  });
  setupResize(resizeHandle, panel);

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border-default, #d0d7de);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `;

  // Iframe
  const iframe = document.createElement('iframe');
  iframe.id = PANEL_IFRAME_ID;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.style.cssText = 'flex: 1; border: none; width: 100%;';

  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 4px 8px;';
  toolbar.appendChild(createViewportToggle(iframe));
  toolbar.appendChild(createZoomControl(iframe, getCachedSettings().defaultZoom));

  panel.appendChild(resizeHandle);
  panel.appendChild(header);
  panel.appendChild(toolbar);
  panel.appendChild(iframe);
  document.body.appendChild(panel);

  applyPageLayout(`${DEFAULT_WIDTH_PCT}%`);

  return panel;
}

/**
 * Show HTML content in the side panel. Creates the panel if it doesn't exist.
 * @param html - HTML content to render in the panel iframe
 * @param fileName - File name to display in the panel header
 */
export function showInPanel(html: string, fileName: string): void {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) panel = createSidePanel();

  const iframe = panel.querySelector('iframe') as HTMLIFrameElement;
  iframe.srcdoc = html;

  // Update header with file name and close button
  const header = panel.children[1] as HTMLElement;
  header.innerHTML = '';

  const nameSpan = document.createElement('span');
  nameSpan.style.fontWeight = '600';
  nameSpan.textContent = fileName;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-sm';
  closeBtn.id = PANEL_CLOSE_ID;
  closeBtn.textContent = '\u2715';
  closeBtn.addEventListener('click', closeSidePanel);

  header.appendChild(nameSpan);
  header.appendChild(closeBtn);
}

/**
 * Close and remove the side panel, restoring the page layout.
 */
export function closeSidePanel(): void {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
    restorePageLayout();
  }
}

/**
 * Apply layout adjustment to push the page content left when panel is open.
 * Targets GitHub's main content containers so the diff/code area shrinks properly.
 * @param width - CSS width string (e.g. '40%')
 */
function applyPageLayout(width: string): void {
  document.body.style.marginRight = width;
  // Also constrain GitHub's main content containers for proper reflow
  const containers = document.querySelectorAll<HTMLElement>(
    '.Layout-main, .repository-content, .diff-view, [data-target="diff-layout.mainContainer"]'
  );
  for (const el of containers) {
    el.style.maxWidth = '100%';
    el.style.overflow = 'auto';
  }
}

/**
 * Restore page layout when panel is closed.
 */
function restorePageLayout(): void {
  document.body.style.marginRight = '';
  const containers = document.querySelectorAll<HTMLElement>(
    '.Layout-main, .repository-content, .diff-view, [data-target="diff-layout.mainContainer"]'
  );
  for (const el of containers) {
    el.style.maxWidth = '';
    el.style.overflow = '';
  }
}

/**
 * Set up mousedown drag-to-resize on the panel's left edge.
 * Uses an overlay during drag to prevent the iframe from stealing mouse events.
 * @param handle - The resize handle element
 * @param panel - The panel element to resize
 */
function setupResize(handle: HTMLElement, panel: HTMLElement): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();

    // Overlay to prevent iframe from capturing mouse during drag
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:col-resize;';
    document.body.appendChild(overlay);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = window.innerWidth - moveEvent.clientX;
      const pct = Math.max(MIN_WIDTH_PCT, Math.min(MAX_WIDTH_PCT, (newWidth / window.innerWidth) * 100));
      const widthStr = `${pct}%`;
      panel.style.width = widthStr;
      applyPageLayout(widthStr);
    };

    const onMouseUp = () => {
      overlay.remove();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}
