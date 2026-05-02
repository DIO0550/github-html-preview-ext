import { injectBaseTag } from './url-utils';
import { sanitizeHtml } from './html-sanitizer';
import { injectSecuritySandbox } from './security-sandbox';
import { openOrReusePreviewTab } from './preview-tab-manager';

/**
 * Build preview HTML by injecting a `<base>` tag, sanitizing external resources,
 * and optionally injecting the security sandbox script.
 * @param rawUrl - The raw GitHub URL of the HTML file
 * @param html - The raw HTML content
 * @param enableJavaScript - Whether to inject security sandbox for JS execution (default true)
 * @returns HTML string ready for safe preview
 */
export function buildPreviewHtml(rawUrl: string, html: string, enableJavaScript: boolean = true): string {
  const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);
  let result = injectBaseTag(html, baseUrl);
  result = sanitizeHtml(result);
  if (enableJavaScript) {
    result = injectSecuritySandbox(result);
  }
  return result;
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
 * @param enableJavaScript - Whether to inject security sandbox for JS execution (default true)
 * @returns HTML string ready for preview
 * @throws Error if fetch fails
 */
export async function fetchPreviewHtml(rawUrl: string, enableJavaScript: boolean = true): Promise<string> {
  const html = await backgroundFetch(rawUrl);
  return buildPreviewHtml(rawUrl, html, enableJavaScript);
}

/**
 * Open or focus the preview tab via the background service worker. Reuses an
 * existing preview tab when one is tracked, otherwise opens a new tab.
 * @param rawUrl - The raw GitHub URL of the HTML file
 * @param enableJavaScript - Whether to enable JS execution in the preview (default true)
 */
export async function fetchAndPreview(rawUrl: string, enableJavaScript: boolean = true): Promise<void> {
  await openOrReusePreviewTab(rawUrl, enableJavaScript);
}
