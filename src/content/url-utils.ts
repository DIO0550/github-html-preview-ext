import type { PageType } from './types';

/**
 * Convert a GitHub blob URL to a raw URL by replacing `/blob/` with `/raw/`.
 * @param url - GitHub blob URL (absolute or relative)
 * @returns Raw URL, or null if the URL does not contain `/blob/`
 */
export function convertBlobToRawUrl(url: string): string | null {
  if (!url.includes('/blob/')) return null;
  return url.replace('/blob/', '/raw/');
}

/**
 * Check whether a file path has an HTML extension (.html or .htm).
 * @param filePath - File name or path to check
 * @returns true if the file is an HTML file
 */
export function isHtmlFile(filePath: string): boolean {
  return /\.html?$/i.test(filePath);
}

/**
 * Inject or overwrite a `<base href>` tag in the given HTML string.
 * Uses DOMParser so it handles missing `<head>`, existing `<base>`, etc.
 * @param html - Raw HTML string
 * @param baseUrl - Base URL to set (e.g. raw URL directory)
 * @returns HTML string with `<base>` injected and DOCTYPE preserved
 */
export function injectBaseTag(html: string, baseUrl: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  let base = doc.querySelector('base');
  if (base) {
    base.href = baseUrl;
  } else {
    base = doc.createElement('base');
    base.href = baseUrl;
    doc.head.prepend(base);
  }

  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}>`
    : '<!DOCTYPE html>';
  return doctype + '\n' + doc.documentElement.outerHTML;
}

/**
 * Determine the GitHub page type from a URL path.
 * @param path - URL pathname (e.g. `/owner/repo/pull/123/files`)
 * @returns Page type: `'pr-files'`, `'blob-html'`, or `'unknown'`
 */
export function getPageType(path: string): PageType {
  if (/\/pull\/\d+\/files/.test(path)) return 'pr-files';
  if (/\/blob\/.*\.html?$/i.test(path)) return 'blob-html';
  return 'unknown';
}
