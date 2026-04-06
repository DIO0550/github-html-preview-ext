import { findHtmlFileHeaders, getRawUrl } from './github-dom';
import { fetchPreviewHtml } from './html-fetcher';
import { createInlinePreview } from './inline-preview';

const INLINE_WRAPPER_CLASS = 'html-preview-inline';

/**
 * Create a "Preview All HTML" button that opens inline previews for every HTML file.
 * @returns Button element, or null if no HTML files are found
 */
export function createBatchPreviewButton(): HTMLButtonElement | null {
  const headers = findHtmlFileHeaders();
  if (headers.length === 0) return null;

  const btn = document.createElement('button');
  btn.className = 'btn btn-sm html-preview-batch-btn';
  btn.textContent = `Preview All HTML (${headers.length})`;
  btn.addEventListener('click', () => previewAllHtml());
  return btn;
}

/**
 * Fetch and inline-preview all HTML files in the current PR.
 * Skips files that already have an open preview. Continues on per-file errors.
 */
async function previewAllHtml(): Promise<void> {
  const headers = findHtmlFileHeaders();
  for (const header of headers) {
    const rawUrl = getRawUrl(header);
    if (!rawUrl) continue;
    const container = header.closest('[id^="diff-"]') ?? header.parentElement;
    if (!container) continue;

    // Skip if already has an open inline preview
    if (container.querySelector(`.${INLINE_WRAPPER_CLASS}`)) continue;

    try {
      const html = await fetchPreviewHtml(rawUrl);
      createInlinePreview(container, html);
    } catch {
      // Continue with remaining files on per-file failure
    }
  }
}
