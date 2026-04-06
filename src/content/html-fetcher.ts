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
 * Fetch raw HTML via the background service worker (avoids CORS restrictions).
 * @param url - The URL to fetch
 * @returns Raw HTML string
 * @throws Error if fetch fails
 */
async function backgroundFetch(url: string): Promise<string> {
  const response = await chrome.runtime.sendMessage({ type: 'fetch-html', url });
  if (response.error) throw new Error(response.error);
  return response.html;
}

/**
 * Fetch raw HTML from GitHub and return it with `<base>` tag injected.
 * Uses background service worker to avoid CORS issues with raw.githubusercontent.com.
 * @param rawUrl - The raw GitHub URL to fetch
 * @returns HTML string ready for preview
 * @throws Error if fetch fails
 */
export async function fetchPreviewHtml(rawUrl: string): Promise<string> {
  const html = await backgroundFetch(rawUrl);
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
