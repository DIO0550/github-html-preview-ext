/**
 * HTML sanitizer module.
 * Removes external resource references and meta refresh tags from HTML
 * before rendering in a preview iframe.
 */

/** Tags and their URL-bearing attributes to check for external URLs */
const EXTERNAL_URL_CHECKS: Array<{ selector: string; attr: string }> = [
  { selector: 'img[src]', attr: 'src' },
  { selector: 'script[src]', attr: 'src' },
  { selector: 'link[href]', attr: 'href' },
  { selector: 'iframe[src]', attr: 'src' },
  { selector: 'video[src]', attr: 'src' },
  { selector: 'audio[src]', attr: 'src' },
  { selector: 'source[src]', attr: 'src' },
  { selector: 'object[data]', attr: 'data' },
  { selector: 'embed[src]', attr: 'src' },
];

/**
 * Check if a URL string is an external URL (http:// or https://).
 * @param url - The URL string to check
 * @returns true if the URL is external
 */
function isExternalUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/**
 * Sanitize HTML by removing external resource tags and meta refresh directives.
 * Uses DOMParser for robust HTML parsing.
 * @param html - Raw HTML string to sanitize
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove tags with external URLs
  for (const { selector, attr } of EXTERNAL_URL_CHECKS) {
    const elements = doc.querySelectorAll(selector);
    for (const el of elements) {
      const value = el.getAttribute(attr) || '';
      if (isExternalUrl(value)) {
        el.remove();
      }
    }
  }

  // Remove <meta http-equiv="refresh">
  const metaTags = doc.querySelectorAll('meta[http-equiv]');
  for (const meta of metaTags) {
    const httpEquiv = meta.getAttribute('http-equiv') || '';
    if (httpEquiv.toLowerCase() === 'refresh') {
      meta.remove();
    }
  }

  return doc.documentElement.outerHTML;
}
