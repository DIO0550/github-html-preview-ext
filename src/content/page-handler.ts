import type { ExtensionSettings } from './settings';
import { getPageType, extractOwnerRepo, matchesWhitelist } from './url-utils';
import {
  addPreviewButtons,
  findHtmlFileHeaders,
  getRawUrl,
  getBlobPageRawUrl,
  getFilePath,
} from './github-dom';
import { createBatchPreviewButton } from './batch-preview';
import { createInlinePreview, removeInlinePreview, updateInlinePreviewContent } from './inline-preview';
import { fetchPreviewHtml } from './html-fetcher';
import { hasActivePreviewTab, updatePreviewTab } from './preview-tab-manager';
import { isSidePanelOpen, updateSidePanelContent } from './side-panel';
import {
  getInlinePreviewRawUrl,
  setInlinePreviewRawUrl,
  getLastPrFilesTabRawUrl,
  setLastPrFilesTabRawUrl,
  getLastPanelRawUrl,
  setLastPanelRawUrl,
  getLastBlobRawUrl,
  setLastBlobRawUrl,
} from './auto-update-cache';
import { debugLog } from './_debug';

const BATCH_BUTTON_SELECTOR = '.html-preview-batch-btn';
const INLINE_WRAPPER_CLASS = 'html-preview-inline';

/**
 * Per-container monotonic token used to ensure that only the latest
 * fetch+render cycle wins. Concurrent file switches all start their
 * fetches; on resolve, callers compare against the current token and
 * drop their result if a newer one has been issued.
 *
 * Backed by a `WeakMap` so DOM containers that are detached and
 * garbage-collected automatically lose their entries — no explicit
 * reset is required (see `auto-update-cache.ts` header note).
 */
const autoPreviewSeq = new WeakMap<Element, number>();

/**
 * Sticky-header offset (in CSS pixels) used by `findTopmostViewportHeader`.
 * GitHub's PR Files-changed page can pin a small toolbar above each diff,
 * so a freshly-clicked file's header sometimes scrolls a few dozen pixels
 * above 0 before settling. Allowing a small negative `top` keeps that
 * file picked as "active".
 */
const STICKY_OFFSET = 80;

/**
 * Extract a commit-SHA-like identifier from a GitHub PR Files-changed
 * `location.hash` such as `#diff-<sha>`, `#diff-<sha>R<n>`, or
 * `#diff-<sha>L<n>-R<m>`. Returns `null` when the hash does not match
 * the expected shape or contains fewer than 7 hex characters.
 * @param hash - Raw `location.hash` value, including the leading `#`
 * @returns The hex SHA portion, or `null`
 */
export function extractDiffShaFromHash(hash: string): string | null {
  const m = /^#diff-([a-f0-9]{7,64})(?:[LR]\d+(?:-[LR]\d+)?)?$/.exec(hash);
  return m ? m[1] : null;
}

/**
 * Locate the file header whose enclosing diff container's `id` begins with
 * `diff-<sha>`. Both the header itself and any ancestor with such an id
 * count, so this works regardless of whether GitHub's markup attaches the
 * id to the header element directly or to the surrounding wrapper.
 * @param headers - Header candidates returned by `findHtmlFileHeaders`
 * @param sha - SHA prefix extracted from `location.hash`
 * @returns The matching header, or `null`
 */
export function findActiveHeaderByHash(headers: Element[], sha: string): Element | null {
  const target = `diff-${sha}`;
  for (const h of headers) {
    const containerId = (h.closest('[id^="diff-"]') as Element | null)?.id;
    if (!containerId) continue;
    if (containerId === target || containerId.startsWith(target)) return h;
  }
  return null;
}

/**
 * Pick the header whose top edge is closest to the viewport top while still
 * visible (allowing a small negative offset for sticky headers).
 * @param headers - Candidate headers
 * @returns The best-positioned header, or `null` if every candidate is
 *          scrolled fully above the viewport
 */
export function findTopmostViewportHeader(headers: Element[]): Element | null {
  let best: Element | null = null;
  let bestTop = Infinity;
  for (const h of headers) {
    const top = h.getBoundingClientRect().top;
    if (top >= -STICKY_OFFSET && top < bestTop) {
      bestTop = top;
      best = h;
    }
  }
  return best;
}

/**
 * Resolve the file header the user is currently viewing on a PR
 * Files-changed page using, in order: (1) `location.hash`, (2) the
 * topmost in-viewport header, (3) the first header in the list as a
 * last-resort fallback. Returns `null` only when there are no HTML
 * headers at all.
 * @returns The active header element, or `null`
 */
function findActivePrHeader(): Element | null {
  const headers = findHtmlFileHeaders();
  if (headers.length === 0) return null;

  const sha = extractDiffShaFromHash(location.hash);
  let active: Element | null = null;
  if (sha) active = findActiveHeaderByHash(headers, sha);
  if (!active) active = findTopmostViewportHeader(headers);
  // Final fallback: the first header. This can momentarily show the
  // wrong file when neither hash nor viewport detection succeeds, but
  // the relaxed STICKY_OFFSET above keeps that case rare.
  if (!active) active = headers[0];
  return active;
}

/**
 * @returns rawUrl of the file the user is currently viewing on a PR
 *          Files-changed page, or `null` if no HTML headers exist or no
 *          rawUrl could be derived for the active one
 */
export function getActivePrFileRawUrl(): string | null {
  const active = findActivePrHeader();
  if (!active) return null;
  return getRawUrl(active);
}

/**
 * Place the active-file header at the front of the list so its preview
 * is fetched first. Other entries keep their relative order.
 * @param headers - Headers in their natural document order
 * @param activeUrl - rawUrl of the active file, or `null`
 * @returns A new array with the active entry moved to position 0
 */
export function reorderHeadersWithActiveFirst(
  headers: Element[],
  activeUrl: string | null
): Element[] {
  if (!activeUrl) return [...headers];
  const idx = headers.findIndex((h) => getRawUrl(h) === activeUrl);
  if (idx <= 0) return [...headers];
  const reordered = [...headers];
  const [active] = reordered.splice(idx, 1);
  reordered.unshift(active);
  return reordered;
}

/**
 * Try to re-render an existing inline preview; fall back to a full
 * remove + recreate if the existing wrapper / iframe / bridge is no
 * longer usable.
 * @param container - DOM element hosting the preview
 * @param html - HTML body to render
 * @param defaultZoom - Zoom percentage applied when recreating
 * @param enableJavaScript - Whether the iframe should retain script permission
 */
function renderOrRecreate(
  container: Element,
  html: string,
  defaultZoom: number,
  enableJavaScript: boolean
): void {
  if (updateInlinePreviewContent(container, html, enableJavaScript)) return;
  removeInlinePreview(container);
  createInlinePreview(container, html, defaultZoom, enableJavaScript);
}

/**
 * Handle a page update: check whitelist, add preview buttons, auto-preview,
 * and push fresh HTML into an open preview tab / side panel when the user
 * has navigated to a new HTML file.
 * @param pathname - Current URL pathname
 * @param settings - Loaded extension settings
 */
export function handlePageUpdate(pathname: string, settings: ExtensionSettings): void {
  const pageType = getPageType(pathname);
  debugLog('handlePageUpdate', { pathname, hash: location.hash, pageType });

  // When leaving a PR Files-changed page, drop the panel/tab caches so the
  // next visit re-syncs even if the active rawUrl coincidentally matches.
  // This must run before the 'unknown' early-return: navigating to e.g. the
  // PR Conversation tab is 'unknown' but still counts as leaving the page.
  if (pageType !== 'pr-files') {
    setLastPrFilesTabRawUrl(null);
    setLastPanelRawUrl(null);
  }

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
    if (rawUrl && rawUrl !== getLastBlobRawUrl()) {
      setLastBlobRawUrl(rawUrl);
      void updatePreviewTab(rawUrl, settings.enableJavaScript);
    }
  }

  if (pageType === 'pr-files') {
    syncExternalPrFilePreviews(settings.enableJavaScript);
  }

  if (settings.autoPreview) {
    if (pageType === 'pr-files') {
      void autoPreviewPrFiles(settings.defaultZoom, settings.enableJavaScript);
    } else if (pageType === 'blob-html') {
      void autoPreviewBlobPage(settings.defaultZoom, settings.enableJavaScript);
    }
  }
}

/**
 * Monotonic token for panel sync fetches. Rapid file switches start
 * overlapping fetches; without ordering, a slow fetch for the previous
 * file can resolve last and overwrite the panel with stale content while
 * the cache claims the new file is shown. Only the latest fetch may render.
 */
let panelSyncSeq = 0;

/**
 * Push the active PR file's rawUrl into any open external preview tab
 * and side panel. Each target keeps its own last-seen rawUrl so we only
 * touch them when the file actually changed.
 * @param enableJavaScript - Whether previews should retain JS permission
 */
function syncExternalPrFilePreviews(enableJavaScript: boolean): void {
  const tabActive = hasActivePreviewTab();
  const panelOpen = isSidePanelOpen();
  if (!tabActive && !panelOpen) return;

  const active = findActivePrHeader();
  if (!active) return;
  const rawUrl = getRawUrl(active);
  if (!rawUrl) return;

  if (tabActive && rawUrl !== getLastPrFilesTabRawUrl()) {
    setLastPrFilesTabRawUrl(rawUrl);
    void updatePreviewTab(rawUrl, enableJavaScript);
  }

  if (panelOpen && rawUrl !== getLastPanelRawUrl()) {
    setLastPanelRawUrl(rawUrl);
    const fileName = getFilePath(active) ?? 'preview.html';
    const seq = ++panelSyncSeq;
    void fetchPreviewHtml(rawUrl, enableJavaScript)
      .then((html) => {
        if (seq !== panelSyncSeq) return; // superseded by a newer file switch
        if (!isSidePanelOpen()) return;
        updateSidePanelContent(html, fileName);
      })
      .catch(() => {
        // Allow next page update to retry; clear cache so it does — unless
        // a newer sync already took over the panel.
        if (seq === panelSyncSeq) setLastPanelRawUrl(null);
      });
  }
}

/**
 * Auto-preview every HTML file in a PR. Active-file header is fetched
 * first (single-fetch latency for the most recent click); other files
 * follow in document order.
 * @param defaultZoom - Zoom percentage for new previews
 * @param enableJavaScript - Whether to enable JS in previews
 */
async function autoPreviewPrFiles(defaultZoom: number, enableJavaScript: boolean): Promise<void> {
  const headers = findHtmlFileHeaders();
  debugLog('headers', headers.length);
  if (headers.length === 0) return;

  const activeUrl = getActivePrFileRawUrl();
  const ordered = reorderHeadersWithActiveFirst(headers, activeUrl);

  for (const header of ordered) {
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
 * Drive a single container through one fetch + render cycle. Uses a
 * per-container token (`autoPreviewSeq`) so the most recently issued
 * cycle always wins — earlier in-flight fetches resolve, see they have
 * been superseded, and drop their result. The rawUrl is recorded only
 * on a successful render so a thrown `createInlinePreview` does not
 * poison the cache.
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
  if (hasWrapper && getInlinePreviewRawUrl(container) === rawUrl) return;

  const previousSeq = autoPreviewSeq.get(container) ?? 0;
  const seq = previousSeq + 1;
  autoPreviewSeq.set(container, seq);

  let html: string;
  try {
    html = await fetchPreviewHtml(rawUrl, enableJavaScript);
  } catch {
    // Silently fail; next observer tick may retry.
    return;
  }

  if (autoPreviewSeq.get(container) !== seq) return;
  if (!container.isConnected) return;

  try {
    renderOrRecreate(container, html, defaultZoom, enableJavaScript);
    setInlinePreviewRawUrl(container, rawUrl);
  } catch {
    // Render failed — leave cache untouched so a future cycle retries.
  }
}
