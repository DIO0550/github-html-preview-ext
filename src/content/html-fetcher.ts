import { injectBaseTag } from './url-utils';

/**
 * Build preview HTML by injecting a `<base>` tag using the raw URL's directory as base.
 * @param rawUrl - The raw GitHub URL of the HTML file
 * @param html - The raw HTML content
 * @returns HTML string with `<base>` tag injected
 */
export function buildPreviewHtml(rawUrl: string, html: string): string {
  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
  return injectBaseTag(html, baseUrl);
}

/**
 * Fetch raw HTML from GitHub and return it with `<base>` tag injected.
 * @param rawUrl - The raw GitHub URL to fetch
 * @returns HTML string ready for preview
 * @throws Error if fetch fails
 */
export async function fetchPreviewHtml(rawUrl: string): Promise<string> {
  const response = await fetch(rawUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return buildPreviewHtml(rawUrl, html);
}

/**
 * Open a new preview tab and fetch+send the HTML to it via background messaging.
 * Opens the tab synchronously (in click event) to avoid popup blockers,
 * then fetches HTML async and sends it via chrome.runtime.sendMessage.
 * @param rawUrl - The raw GitHub URL of the HTML file
 */
export async function fetchAndPreview(rawUrl: string): Promise<void> {
  const previewId = crypto.randomUUID();
  const previewUrl = chrome.runtime.getURL(`src/preview.html?id=${previewId}`);
  window.open(previewUrl, '_blank');

  try {
    const htmlWithBase = await fetchPreviewHtml(rawUrl);
    chrome.runtime.sendMessage({
      type: 'preview-store',
      id: previewId,
      html: htmlWithBase,
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'preview-store',
      id: previewId,
      html: null,
      error: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
