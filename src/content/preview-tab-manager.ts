import { fetchPreviewHtml } from './html-fetcher';
import type {
  OpenPreviewTabMessage,
  OpenPreviewTabResponse,
  UpdatePreviewMessage,
  UpdatePreviewResponse,
} from './types';

let currentPreviewTabId: number | null = null;

/**
 * Reset the cached preview tab id. Used when the tab is known to be closed
 * and from tests for state reset.
 */
export function clearPreviewTab(): void {
  currentPreviewTabId = null;
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
 * for subsequent calls.
 * @param rawUrl - Raw GitHub URL of the HTML file to preview
 * @param enableJavaScript - Whether to enable JS execution in the preview
 */
export async function openOrReusePreviewTab(
  rawUrl: string,
  enableJavaScript: boolean
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
  }
}

/**
 * Push fresh HTML into the existing preview tab. Does nothing if no preview
 * tab is currently tracked. If the background reports the tab no longer
 * exists, the cached id is cleared so the next click opens a new tab.
 * @param rawUrl - Raw GitHub URL of the HTML file to preview
 * @param enableJavaScript - Whether to enable JS execution in the preview
 */
export async function updatePreviewTab(
  rawUrl: string,
  enableJavaScript: boolean
): Promise<void> {
  if (currentPreviewTabId === null) return;

  const html = await fetchPreviewHtml(rawUrl, enableJavaScript);
  const message: UpdatePreviewMessage = {
    type: 'update-preview',
    tabId: currentPreviewTabId,
    html,
    enableJavaScript,
  };
  const response: UpdatePreviewResponse = await chrome.runtime.sendMessage(message);
  if (!response.ok) {
    currentPreviewTabId = null;
  }
}
