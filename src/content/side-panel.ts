import { createViewportToggle } from './viewport-toggle';

const PANEL_ID = 'html-preview-panel';
const PANEL_IFRAME_ID = 'html-preview-panel-iframe';
const PANEL_CLOSE_ID = 'html-preview-panel-close';
const PANEL_WIDTH = '40%';

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
    width: ${PANEL_WIDTH};
    height: 100vh;
    background: var(--color-canvas-default);
    border-left: 1px solid var(--color-border-default);
    z-index: 100;
    display: flex;
    flex-direction: column;
    box-shadow: -2px 0 8px rgba(0,0,0,0.1);
  `;

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 4px;
    height: 100%;
    cursor: col-resize;
  `;
  setupResize(resizeHandle, panel);

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border-default);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `;

  // Iframe
  const iframe = document.createElement('iframe');
  iframe.id = PANEL_IFRAME_ID;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = 'flex: 1; border: none; width: 100%;';

  const toggle = createViewportToggle(iframe);

  panel.appendChild(resizeHandle);
  panel.appendChild(header);
  panel.appendChild(toggle);
  panel.appendChild(iframe);
  document.body.appendChild(panel);

  document.body.style.marginRight = PANEL_WIDTH;

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
    document.body.style.marginRight = '';
  }
}

/**
 * Set up mousedown drag-to-resize on the panel's left edge.
 * @param handle - The resize handle element
 * @param panel - The panel element to resize
 */
function setupResize(handle: HTMLElement, panel: HTMLElement): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = window.innerWidth - moveEvent.clientX;
      const widthPct = `${Math.max(20, Math.min(80, (newWidth / window.innerWidth) * 100))}%`;
      panel.style.width = widthPct;
      document.body.style.marginRight = widthPct;
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}
