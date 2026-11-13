import type { PageType } from './types';

const ALLOWED_RAW_HOSTS = new Set(['github.com', 'raw.githubusercontent.com']);

/**
 * Extract the `"owner/repo"` pair from a GitHub or raw.githubusercontent.com
 * raw URL. Validates the protocol (`https:`), hostname, and path structure.
 * @param rawUrl - Absolute URL string to inspect
 * @returns `"owner/repo"` when valid, or null when disallowed / malformed
 */
export function parseAllowedRawUrlRepo(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_RAW_HOSTS.has(parsed.hostname)) {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (parsed.hostname === 'github.com') {
    if (segments.length < 5 || segments[2] !== 'raw') {
      return null;
    }
    return `${segments[0]}/${segments[1]}`;
  }

  if (segments.length < 4) {
    return null;
  }
  return `${segments[0]}/${segments[1]}`;
}

/**
 * Convert a GitHub blob URL to a raw URL by replacing `/blob/` with `/raw/`.
 * Rejects non-GitHub hosts, non-HTTPS protocols (except relative paths and
 * test-environment `location.origin`), and URLs whose path structure does not
 * follow `/<owner>/<repo>/blob/<ref>/<path>`.
 * @param url - GitHub blob URL (absolute or relative)
 * @param allowedOrigin - Optional current page origin permitted alongside `https://github.com`
 * @returns Raw URL, or null if the URL is not a valid GitHub blob URL
 */
export function convertBlobToRawUrl(url: string, allowedOrigin?: string): string | null {
  if (!url.includes('/blob/')) {
    return null;
  }

  if (url.startsWith('/')) {
    const match = /^\/([^/]+\/[^/]+)\/blob\/(.+)$/.exec(url);
    if (!match) {
      return null;
    }
    return `/${match[1]}/raw/${match[2]}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const isTrustedOrigin =
    parsed.origin === 'https://github.com' ||
    (allowedOrigin !== undefined && parsed.origin === allowedOrigin);
  if (!isTrustedOrigin) {
    return null;
  }

  const match = /^\/([^/]+\/[^/]+)\/blob\/(.+)$/.exec(parsed.pathname);
  if (!match) {
    return null;
  }

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
 * Commit diff views — both the repository commit page (`/commit/<sha>`) and
 * the PR Commits tab (`/pull/<n>/commits/<sha>`) — render the same file
 * headers as PR Files-changed, so they get their own diff page type.
 * @param path - URL pathname (e.g. `/owner/repo/pull/123/files`)
 * @returns Page type: `'pr-files'`, `'commit'`, `'blob-html'`, or `'unknown'`
 */
export function getPageType(path: string): PageType {
  if (/\/pull\/\d+\/(files|changes)/.test(path)) return 'pr-files';
  if (/\/pull\/\d+\/commits\/[0-9a-f]{7,40}\b/i.test(path)) return 'commit';
  if (/\/commit\/[0-9a-f]{7,40}\b/i.test(path)) return 'commit';
  if (/\/blob\/.*\.html?$/i.test(path)) return 'blob-html';
  return 'unknown';
}

/**
 * Whether a page type renders file diff headers (PR Files-changed or a
 * commit view). Diff pages share the preview-button / auto-preview /
 * panel-tab sync pipeline.
 * @param pageType - Page type returned by `getPageType`
 * @returns true for diff-style pages
 */
export function isDiffPage(pageType: PageType): boolean {
  return pageType === 'pr-files' || pageType === 'commit';
}
