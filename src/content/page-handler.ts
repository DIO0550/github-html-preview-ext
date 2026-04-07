import type { ExtensionSettings } from './settings';
import { getPageType, extractOwnerRepo, matchesWhitelist } from './url-utils';
import { addPreviewButtons, findHtmlFileHeaders, getRawUrl, getBlobPageRawUrl } from './github-dom';
import { createBatchPreviewButton } from './batch-preview';
import { createInlinePreview } from './inline-preview';
import { fetchPreviewHtml } from './html-fetcher';

const BATCH_BUTTON_SELECTOR = '.html-preview-batch-btn';
const INLINE_WRAPPER_CLASS = 'html-preview-inline';
const autoPreviewInFlight = new WeakSet<Element>();

/**
 * Handle a page update: check whitelist, add preview buttons, auto-preview.
 * Called by the observer callback after settings are loaded.
 * @param pathname - Current URL pathname
 * @param settings - Loaded extension settings
 */
export function handlePageUpdate(pathname: string, settings: ExtensionSettings): void {
  const pageType = getPageType(pathname);
  if (pageType === 'unknown') return;

  const ownerRepo = extractOwnerRepo(pathname);
  if (!ownerRepo || !matchesWhitelist(ownerRepo, settings.allowedRepos)) return;

  addPreviewButtons(pageType);

  if (pageType === 'pr-files' && !document.querySelector(BATCH_BUTTON_SELECTOR)) {
    const batchBtn = createBatchPreviewButton();
    if (batchBtn) {
      const diffHeader = document.querySelector('#diff-header, .pr-toolbar, .diffbar');
      if (diffHeader) {
        diffHeader.appendChild(batchBtn);
      }
    }
  }

  if (settings.autoPreview) {
    if (pageType === 'pr-files') {
      autoPreviewPrFiles(settings.defaultZoom);
    } else if (pageType === 'blob-html') {
      autoPreviewBlobPage(settings.defaultZoom);
    }
  }
}

/**
 * Auto-preview all HTML files in a PR that don't already have an inline preview.
 * @param defaultZoom - Zoom percentage for new previews
 */
async function autoPreviewPrFiles(defaultZoom: number): Promise<void> {
  const headers = findHtmlFileHeaders();
  for (const header of headers) {
    const rawUrl = getRawUrl(header);
    if (!rawUrl) continue;
    const container = header.closest('[id^="diff-"]') ?? header.parentElement;
    if (!container) continue;
    if (container.querySelector(`.${INLINE_WRAPPER_CLASS}`)) continue;
    if (autoPreviewInFlight.has(container)) continue;
    autoPreviewInFlight.add(container);

    try {
      const html = await fetchPreviewHtml(rawUrl);
      if (!container.querySelector(`.${INLINE_WRAPPER_CLASS}`)) {
        createInlinePreview(container, html, defaultZoom);
      }
    } catch {
      // Continue with remaining files
    } finally {
      autoPreviewInFlight.delete(container);
    }
  }
}

/**
 * Auto-preview the HTML file on a blob page.
 * @param defaultZoom - Zoom percentage for the preview
 */
async function autoPreviewBlobPage(defaultZoom: number): Promise<void> {
  const rawUrl = getBlobPageRawUrl();
  if (!rawUrl) return;

  const container = document.querySelector(
    '[class*="BlobViewContent-module"], [class*="CodeView-module"], .repository-content'
  );
  if (!container) return;
  if (container.querySelector(`.${INLINE_WRAPPER_CLASS}`)) return;
  if (autoPreviewInFlight.has(container)) return;
  autoPreviewInFlight.add(container);

  try {
    const html = await fetchPreviewHtml(rawUrl);
    if (!container.querySelector(`.${INLINE_WRAPPER_CLASS}`)) {
      createInlinePreview(container, html, defaultZoom);
    }
  } catch {
    // Silently fail
  } finally {
    autoPreviewInFlight.delete(container);
  }
}
