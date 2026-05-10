/**
 * Centralised state cache for the auto-preview / auto-update pipeline.
 *
 * This module owns four pieces of state used to decide whether the
 * inline / panel / new-tab previews need re-rendering on the next
 * `handlePageUpdate`:
 *
 * - `inlinePreviewRawUrls`: per-container map of the last rawUrl that was
 *   rendered inside the inline iframe.
 * - `lastPrFilesTabRawUrl`: rawUrl most recently pushed into the external
 *   preview tab on a PR Files-changed page.
 * - `lastPanelRawUrl`: rawUrl most recently pushed into the side panel on
 *   a PR Files-changed page.
 * - `lastBlobRawUrl`: rawUrl most recently pushed into the external preview
 *   tab from a blob-html page (existing behavior).
 *
 * Splitting this state out of `page-handler.ts` is intentional: it lets
 * `side-panel.ts` and `preview-tab-manager.ts` perform their own resets when
 * they tear down, without importing `page-handler` (which would otherwise
 * cycle since `page-handler` imports them). All three modules import
 * one-way from this leaf module.
 *
 * Note: `autoPreviewSeq` (the per-container token used for race control)
 * is intentionally not stored here. It is a `WeakMap<Element, number>`
 * scoped to the inline render path in `page-handler.ts`; container DOM
 * being garbage-collected automatically clears any stale entry, so an
 * explicit reset is unnecessary.
 */

let inlinePreviewRawUrls = new WeakMap<Element, string>();
let lastPrFilesTabRawUrl: string | null = null;
let lastPanelRawUrl: string | null = null;
let lastBlobRawUrl: string | null = null;

/**
 * Get the rawUrl most recently rendered into the inline preview for the
 * given container.
 * @param container - DOM element that hosts the inline preview wrapper
 * @returns The rawUrl, or `undefined` when nothing has been rendered yet
 */
export function getInlinePreviewRawUrl(container: Element): string | undefined {
  return inlinePreviewRawUrls.get(container);
}

/**
 * Record the rawUrl that was successfully rendered into the inline preview
 * for the given container.
 * @param container - DOM element that hosts the inline preview wrapper
 * @param rawUrl - The rawUrl rendered
 */
export function setInlinePreviewRawUrl(container: Element, rawUrl: string): void {
  inlinePreviewRawUrls.set(container, rawUrl);
}

/** @returns rawUrl most recently pushed into the external preview tab from PR Files. */
export function getLastPrFilesTabRawUrl(): string | null {
  return lastPrFilesTabRawUrl;
}

/**
 * Update the rawUrl tracker for the PR Files preview tab.
 * @param v - The rawUrl, or `null` to clear the tracker
 */
export function setLastPrFilesTabRawUrl(v: string | null): void {
  lastPrFilesTabRawUrl = v;
}

/** @returns rawUrl most recently pushed into the side panel from PR Files. */
export function getLastPanelRawUrl(): string | null {
  return lastPanelRawUrl;
}

/**
 * Update the rawUrl tracker for the side panel.
 * @param v - The rawUrl, or `null` to clear the tracker
 */
export function setLastPanelRawUrl(v: string | null): void {
  lastPanelRawUrl = v;
}

/** @returns rawUrl most recently pushed into the external preview tab from a blob page. */
export function getLastBlobRawUrl(): string | null {
  return lastBlobRawUrl;
}

/**
 * Update the rawUrl tracker for the blob page preview tab.
 * @param v - The rawUrl, or `null` to clear the tracker
 */
export function setLastBlobRawUrl(v: string | null): void {
  lastBlobRawUrl = v;
}

/** Reset only the side panel rawUrl tracker. */
export function resetLastPanelRawUrl(): void {
  lastPanelRawUrl = null;
}

/** Reset only the PR Files preview tab rawUrl tracker. */
export function resetLastPrFilesTabRawUrl(): void {
  lastPrFilesTabRawUrl = null;
}

/** Reset only the blob page preview tab rawUrl tracker. */
export function resetLastBlobRawUrl(): void {
  lastBlobRawUrl = null;
}

/**
 * Drop every cache entry. Used on settings changes (e.g. `enableJavaScript`
 * toggled) so that the next page update treats every container/panel/tab as
 * fresh and re-renders with the new settings.
 *
 * `inlinePreviewRawUrls` is replaced with a new WeakMap so previously
 * recorded containers also miss the cache. The `autoPreviewSeq` WeakMap in
 * `page-handler` is intentionally left alone (see module header).
 */
export function resetAllAutoUpdateCaches(): void {
  inlinePreviewRawUrls = new WeakMap<Element, string>();
  lastPrFilesTabRawUrl = null;
  lastPanelRawUrl = null;
  lastBlobRawUrl = null;
}
