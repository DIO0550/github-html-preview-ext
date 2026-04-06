import type { ButtonState } from './types';
import { fetchAndPreview, fetchPreviewHtml } from './html-fetcher';
import { toggleInlinePreview } from './inline-preview';
import { showInPanel } from './side-panel';
import { getFilePath } from './github-dom';

const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';
const BUTTON_CLASSES = 'html-preview-btn btn btn-sm';
const DEFAULT_LABEL = 'Preview';
const ERROR_REVERT_MS = 3000;

/**
 * Create a preview button element with a given label.
 * @param label - Button text to display
 * @param onClick - Click handler to invoke when the button is clicked
 * @returns The created button element
 */
export function createPreviewButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = BUTTON_CLASSES;
  btn.textContent = label;
  btn.dataset.label = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Insert a button into a file header element.
 * Tries `.file-actions`, then `.file-info`, then appends to header itself.
 * @param header - File header DOM element
 * @param button - Button element to insert
 */
export function insertPreviewButton(header: Element, button: HTMLButtonElement): void {
  const actions = header.querySelector('.file-actions');
  if (actions) {
    actions.prepend(button);
    return;
  }

  const info = header.querySelector('.file-info');
  if (info) {
    info.appendChild(button);
    return;
  }

  header.appendChild(button);
}

/**
 * Update a button's visual state (idle, loading, error).
 * On error, reverts to idle after 3 seconds.
 * @param btn - The button element to update
 * @param state - Target state
 * @param message - Optional message to display (used for error state)
 */
export function updateButtonState(btn: HTMLButtonElement, state: ButtonState, message?: string): void {
  switch (state) {
    case 'loading':
      btn.textContent = 'Loading...';
      btn.disabled = true;
      break;
    case 'error':
      btn.textContent = message ?? 'Error';
      btn.disabled = false;
      setTimeout(() => updateButtonState(btn, 'idle'), ERROR_REVERT_MS);
      break;
    case 'idle':
      btn.textContent = btn.dataset.label ?? DEFAULT_LABEL;
      btn.disabled = false;
      break;
  }
}

/**
 * Add 3 preview buttons (Preview, Inline, Panel) to a file header if not already present.
 * @param header - File header DOM element
 * @param rawUrl - Raw URL for the HTML file
 */
export function addPreviewButtonToHeader(header: Element, rawUrl: string): void {
  if (header.querySelector(PREVIEW_BUTTON_SELECTOR)) return;

  const fileName = getFilePath(header) ?? 'preview.html';

  // Find the container for inline preview:
  // PR files: diff block, Blob page: main content wrapper
  const diffContainer = header.closest('[id^="diff-"]')
    ?? document.querySelector('[class*="BlobViewContent-module"], [class*="CodeView-module"], .repository-content')
    ?? header.parentElement;

  // Panel button (inserted first so it appears last due to prepend)
  const panelBtn = createPreviewButton('Panel', async () => {
    updateButtonState(panelBtn, 'loading');
    try {
      const html = await fetchPreviewHtml(rawUrl);
      showInPanel(html, fileName);
      updateButtonState(panelBtn, 'idle');
    } catch (e) {
      updateButtonState(panelBtn, 'error', e instanceof Error ? e.message : 'Preview failed');
    }
  });
  insertPreviewButton(header, panelBtn);

  // Inline button
  const inlineBtn = createPreviewButton('Inline', async () => {
    if (!diffContainer) return;
    updateButtonState(inlineBtn, 'loading');
    try {
      const html = await fetchPreviewHtml(rawUrl);
      toggleInlinePreview(diffContainer, html);
      updateButtonState(inlineBtn, 'idle');
    } catch (e) {
      updateButtonState(inlineBtn, 'error', e instanceof Error ? e.message : 'Preview failed');
    }
  });
  insertPreviewButton(header, inlineBtn);

  // Preview button (new tab) — inserted last so it appears first
  const previewBtn = createPreviewButton('Preview', () => {
    fetchAndPreview(rawUrl);
  });
  insertPreviewButton(header, previewBtn);
}
