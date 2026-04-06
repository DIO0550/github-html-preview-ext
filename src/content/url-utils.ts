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
 * Extract the owner/repo pair from a GitHub URL path.
 * @param path - URL pathname (e.g. `/owner/repo/pull/123/files`)
 * @returns `"owner/repo"` string, or null if path has fewer than 2 segments
 */
export function extractOwnerRepo(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  return `${segments[0]}/${segments[1]}`;
}

/**
 * Check whether an owner/repo matches any entry in the whitelist.
 * Supports exact match (`owner/repo`) and org wildcard (`owner/*`).
 * Comparison is case-insensitive.
 * @param ownerRepo - The `"owner/repo"` string to check
 * @param allowedRepos - Whitelist entries
 * @returns true if the repo matches any whitelist entry
 */
export function matchesWhitelist(ownerRepo: string, allowedRepos: string[]): boolean {
  const normalized = ownerRepo.toLowerCase();
  const [owner] = normalized.split('/');
  return allowedRepos.some((entry) => {
    const normalizedEntry = entry.toLowerCase();
    if (normalizedEntry === `${owner}/*` && !normalizedEntry.startsWith('*')) {
      return true;
    }
    return normalizedEntry === normalized;
  });
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
