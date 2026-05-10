import { fetchPreviewHtml } from './html-fetcher';
import { resetLastPrFilesTabRawUrl } from './auto-update-cache';
import type {
  OpenPreviewTabMessage,
  OpenPreviewTabResponse,
  UpdatePreviewMessage,
  UpdatePreviewResponse,
} from './types';

let currentPreviewTabId: number | null = null;

/**
 * Reset the cached preview tab id. Used when the tab is known to be closed
 * and from tests for state reset. Also clears the PR Files-changed
 * rawUrl tracker so a future open re-syncs from scratch.
 */
export function clearPreviewTab(): void {
  currentPreviewTabId = null;
  resetLastPrFilesTabRawUrl();
}

/**
 * Whether there is currently a tracked preview tab.
 * @returns true if a preview tabId is held in memory
 */
export function hasActivePreviewTab(): boolean {
  return currentPreviewTabId !== null;
}

/**
 * Fetch preview HTML and either open a new preview tab or focus the existing one.
 * The background script decides between `chrome.tabs.create` and
 * `chrome.tabs.update` based on `existingTabId`. The resolved tabId is cached
 * for subsequent calls. The optional `onReady` callback fires after the
 * tabId is recorded so callers can drive an initial-sync `handlePageUpdate`
 * without needing to import this module's internals.
 * @param rawUrl - Raw GitHub URL of the HTML file to preview
 * @param enableJavaScript - Whether to enable JS execution in the preview
 * @param onReady - Optional callback invoked after the resolved tabId is
 *                  cached
 */
export async function openOrReusePreviewTab(
  rawUrl: string,
  enableJavaScript: boolean,
  onReady?: () => void
): Promise<void> {
  const html = await fetchPreviewHtml(rawUrl, enableJavaScript);
  const message: OpenPreviewTabMessage = {
    type: 'open-preview-tab',
    html,
    enableJavaScript,
    existingTabId: currentPreviewTabId,
  };
  const response: OpenPreviewTabResponse = await chrome.runtime.sendMessage(message);
  if (response.tabId != null) {
    currentPreviewTabId = response.tabId;
    onReady?.();
  }
}

/**
 * Push fresh HTML into the existing preview tab. Does nothing if no preview
 * tab is currently tracked. If the background reports the tab no longer
 * exists, the cached id is cleared so the next click opens a new tab.
 *
 * The tabId is captured at entry time so that an overlapping call which
 * receives `ok: false` and clears `currentPreviewTabId` cannot make this
 * invocation send a `tabId: null` message — `chrome.tabs.sendMessage` on
 * the background side throws "No matching signature" for non-integer tabIds.
 * @param rawUrl - Raw GitHub URL of the HTML file to preview
 * @param enableJavaScript - Whether to enable JS execution in the preview
 */
export async function updatePreviewTab(
  rawUrl: string,
  enableJavaScript: boolean
): Promise<void> {
  const tabId = currentPreviewTabId;
  if (tabId === null) return;

  const html = await fetchPreviewHtml(rawUrl, enableJavaScript);
  const message: UpdatePreviewMessage = {
    type: 'update-preview',
    tabId,
    html,
    enableJavaScript,
  };
  const response: UpdatePreviewResponse = await chrome.runtime.sendMessage(message);
  if (!response.ok && currentPreviewTabId === tabId) {
    currentPreviewTabId = null;
  }
}
