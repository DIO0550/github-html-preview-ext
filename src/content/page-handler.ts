import type { ExtensionSettings } from './settings';
import { getPageType, extractOwnerRepo, matchesWhitelist } from './url-utils';
import { addPreviewButtons, findHtmlFileHeaders, getRawUrl, getBlobPageRawUrl } from './github-dom';
import { createBatchPreviewButton } from './batch-preview';
import { createInlinePreview, updateInlinePreviewContent } from './inline-preview';
import { fetchPreviewHtml } from './html-fetcher';
import { hasActivePreviewTab, updatePreviewTab } from './preview-tab-manager';

const BATCH_BUTTON_SELECTOR = '.html-preview-batch-btn';
const INLINE_WRAPPER_CLASS = 'html-preview-inline';
const autoPreviewInFlight = new WeakSet<Element>();
const inlinePreviewRawUrls = new WeakMap<Element, string>();

let lastBlobRawUrl: string | null = null;

/**
 * Reset the cached last-seen blob raw URL. Used by tests to start from a
 * clean state between cases.
 */
export function resetLastBlobUrl(): void {
  lastBlobRawUrl = null;
}

/**
 * Handle a page update: check whitelist, add preview buttons, auto-preview,
 * and push fresh HTML into an open preview tab when the user has navigated
 * to a new HTML file in the GitHub Code tab.
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

  if (pageType === 'blob-html' && hasActivePreviewTab()) {
    const rawUrl = getBlobPageRawUrl();
    if (rawUrl && rawUrl !== lastBlobRawUrl) {
      lastBlobRawUrl = rawUrl;
      void updatePreviewTab(rawUrl, settings.enableJavaScript);
    }
  }

  if (settings.autoPreview) {
    if (pageType === 'pr-files') {
      autoPreviewPrFiles(settings.defaultZoom, settings.enableJavaScript);
    } else if (pageType === 'blob-html') {
      autoPreviewBlobPage(settings.defaultZoom, settings.enableJavaScript);
    }
  }
}

/**
 * Auto-preview all HTML files in a PR that don't already have an inline preview.
 * If a container already has a preview but the file's raw URL has changed
 * (e.g. user switched files in single-file mode), re-render it in place.
 * @param defaultZoom - Zoom percentage for new previews
 * @param enableJavaScript - Whether to enable JS in previews
 */
async function autoPreviewPrFiles(defaultZoom: number, enableJavaScript: boolean): Promise<void> {
  const headers = findHtmlFileHeaders();
  for (const header of headers) {
    const rawUrl = getRawUrl(header);
    if (!rawUrl) continue;
    const container = header.closest('[id^="diff-"]') ?? header.parentElement;
    if (!container) continue;
    await autoPreviewContainer(container, rawUrl, defaultZoom, enableJavaScript);
  }
}

/**
 * Auto-preview the HTML file on a blob page. Re-renders an existing inline
 * preview when the user switches to a different file (raw URL change).
 * @param defaultZoom - Zoom percentage for the preview
 * @param enableJavaScript - Whether to enable JS in previews
 */
async function autoPreviewBlobPage(defaultZoom: number, enableJavaScript: boolean): Promise<void> {
  const rawUrl = getBlobPageRawUrl();
  if (!rawUrl) return;

  const container = document.querySelector(
    '[class*="BlobViewContent-module"], [class*="CodeView-module"], .repository-content'
  );
  if (!container) return;
  await autoPreviewContainer(container, rawUrl, defaultZoom, enableJavaScript);
}

/**
 * Shared auto-preview logic for a single container: create the preview if
 * absent, update it in place if the raw URL changed, otherwise no-op.
 * @param container - DOM element that hosts the inline preview
 * @param rawUrl - Raw URL to fetch HTML from
 * @param defaultZoom - Zoom percentage applied when creating a new preview
 * @param enableJavaScript - Whether to allow JS execution in the iframe
 */
async function autoPreviewContainer(
  container: Element,
  rawUrl: string,
  defaultZoom: number,
  enableJavaScript: boolean
): Promise<void> {
  const hasWrapper = container.querySelector(`.${INLINE_WRAPPER_CLASS}`) !== null;
  if (hasWrapper && inlinePreviewRawUrls.get(container) === rawUrl) return;
  if (autoPreviewInFlight.has(container)) return;
  autoPreviewInFlight.add(container);

  try {
    const html = await fetchPreviewHtml(rawUrl, enableJavaScript);
    if (container.querySelector(`.${INLINE_WRAPPER_CLASS}`)) {
      updateInlinePreviewContent(container, html, enableJavaScript);
    } else {
      createInlinePreview(container, html, defaultZoom, enableJavaScript);
    }
    inlinePreviewRawUrls.set(container, rawUrl);
  } catch {
    // Silently fail; next observer tick may retry
  } finally {
    autoPreviewInFlight.delete(container);
  }
}
