import { createViewportToggle } from './viewport-toggle';
import { getCachedSettings } from './settings';
import { setupPreviewFrameBridge, type PreviewFrameBridge } from './preview-frame-bridge';
import { resetLastPanelRawUrl } from './auto-update-cache';

const PANEL_ID = 'html-preview-panel';
const PANEL_IFRAME_ID = 'html-preview-panel-iframe';
const PANEL_CLOSE_ID = 'html-preview-panel-close';
const PANEL_HEADER_TESTID = 'html-preview-panel-header';
const DEFAULT_WIDTH_PCT = 40;
const MIN_WIDTH_PCT = 15;
const MAX_WIDTH_PCT = 85;

let panelBridge: PreviewFrameBridge | null = null;

/**
 * @returns `true` when the side panel is currently mounted in the DOM
 */
export function isSidePanelOpen(): boolean {
  return document.getElementById(PANEL_ID) !== null;
}

/**
 * Create a fixed side panel on the right of the page with a resize handle,
 * header, and an iframe pointing at preview-frame.html (manifest sandbox
 * page) for safe rendering. The optional `onReady` callback fires once the
 * panel is fully attached and the bridge is initialised, allowing the
 * caller to drive the first render without needing to import this module's
 * internals.
 * @param onReady - Optional callback invoked synchronously after the panel
 *                  is in the DOM and the bridge is set up
 * @returns The created panel element
 */
export function createSidePanel(onReady?: () => void): HTMLElement {
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
  resizeHandle.addEventListener('mouseenter', () => {
    resizeHandle.style.background = 'var(--color-accent-fg, #0969da)';
    resizeHandle.style.opacity = '0.4';
  });
  resizeHandle.addEventListener('mouseleave', () => {
    resizeHandle.style.background = '';
    resizeHandle.style.opacity = '';
  });
  setupResize(resizeHandle, panel);

  const header = document.createElement('div');
  header.dataset.testid = PANEL_HEADER_TESTID;
  header.style.cssText = `
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border-default, #d0d7de);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `;

  const iframe = document.createElement('iframe');
  iframe.id = PANEL_IFRAME_ID;
  iframe.src = chrome.runtime.getURL('src/preview-frame.html');
  iframe.style.cssText = 'flex: 1; border: none; width: 100%;';

  panelBridge = setupPreviewFrameBridge(iframe);

  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 4px 8px;';
  toolbar.appendChild(createViewportToggle(iframe));

  panel.appendChild(resizeHandle);
  panel.appendChild(header);
  panel.appendChild(toolbar);
  panel.appendChild(iframe);
  document.body.appendChild(panel);

  applyPageLayout(`${DEFAULT_WIDTH_PCT}%`);

  onReady?.();

  return panel;
}

/**
 * Re-render an already-open side panel with new content. No-op when the
 * panel is not currently mounted; this lets callers drive auto-update
 * without accidentally re-opening the panel after the user closed it.
 * @param html - HTML content to render in the panel iframe
 * @param fileName - File name to display in the panel header
 */
export function updateSidePanelContent(html: string, fileName: string): void {
  const panel = document.getElementById(PANEL_ID);
  if (!panel || !panelBridge) return;

  const enableJavaScript = getCachedSettings().enableJavaScript;
  panelBridge.render(html, enableJavaScript);

  const header = panel.querySelector<HTMLElement>(`[data-testid="${PANEL_HEADER_TESTID}"]`);
  if (!header) return;
  renderPanelHeader(header, fileName);
}

/**
 * Show HTML content in the side panel. Creates the panel if it doesn't exist.
 * @param html - HTML content to render in the panel iframe
 * @param fileName - File name to display in the panel header
 */
export function showInPanel(html: string, fileName: string): void {
  if (!isSidePanelOpen()) createSidePanel();
  updateSidePanelContent(html, fileName);
}

/**
 * Close and remove the side panel, restoring the page layout. Tears down
 * the postMessage bridge and clears the panel rawUrl cache so a future
 * open will re-sync from scratch.
 */
export function closeSidePanel(): void {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    if (panelBridge) {
      panelBridge.destroy();
      panelBridge = null;
    }
    panel.remove();
    restorePageLayout();
  }
  resetLastPanelRawUrl();
}

/**
 * Replace the panel header's contents with a file-name label and a close
 * button. Extracted so it can be reused from both `createSidePanel` (via
 * `updateSidePanelContent`) and any future direct callers.
 * @param header - Header element returned by `panel.querySelector`
 * @param fileName - File name to display
 */
function renderPanelHeader(header: HTMLElement, fileName: string): void {
  header.innerHTML = '';

  const nameSpan = document.createElement('span');
  nameSpan.style.fontWeight = '600';
  nameSpan.textContent = fileName;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-sm';
  closeBtn.id = PANEL_CLOSE_ID;
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeSidePanel);

  header.appendChild(nameSpan);
  header.appendChild(closeBtn);
}

/**
 * Apply layout adjustment to push the page content left when panel is open.
 * Targets GitHub's main content containers so the diff/code area shrinks properly.
 * @param width - CSS width string (e.g. '40%')
 */
function applyPageLayout(width: string): void {
  document.body.style.marginRight = width;
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

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:col-resize;';
    document.body.appendChild(overlay);

    const onMouseMove = (moveEvent: MouseEvent): void => {
      const newWidth = window.innerWidth - moveEvent.clientX;
      const pct = Math.max(MIN_WIDTH_PCT, Math.min(MAX_WIDTH_PCT, (newWidth / window.innerWidth) * 100));
      const widthStr = `${pct}%`;
      panel.style.width = widthStr;
      applyPageLayout(widthStr);
    };

    const onMouseUp = (): void => {
      overlay.remove();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}
