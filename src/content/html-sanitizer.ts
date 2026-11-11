/**
 * HTML sanitizer module.
 * Removes external resource references, CSS exfiltration URLs, ping/form
 * submission targets, and meta refresh tags, and injects strict CSP +
 * no-referrer meta tags before rendering in a preview iframe.
 */

export const PREVIEW_CSP_CONTENT = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://github.com https://raw.githubusercontent.com",
  'img-src data: blob: https://github.com https://raw.githubusercontent.com',
  'font-src data: https://github.com https://raw.githubusercontent.com',
  'media-src data: blob: https://github.com https://raw.githubusercontent.com',
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
].join('; ');

/** Tags and their URL-bearing attributes whose entire element is removed when external */
const EXTERNAL_URL_ELEMENT_CHECKS: ReadonlyArray<{ selector: string; attr: string }> = [
  { selector: 'img[src]', attr: 'src' },
  { selector: 'script[src]', attr: 'src' },
  { selector: 'script[href]', attr: 'href' },
  { selector: 'script[xlink\\:href]', attr: 'xlink:href' },
  { selector: 'link[href]', attr: 'href' },
  { selector: 'iframe[src]', attr: 'src' },
  { selector: 'video[src]', attr: 'src' },
  { selector: 'audio[src]', attr: 'src' },
  { selector: 'source[src]', attr: 'src' },
  { selector: 'object[data]', attr: 'data' },
  { selector: 'embed[src]', attr: 'src' },
  { selector: 'image[href]', attr: 'href' },
  { selector: 'image[xlink\\:href]', attr: 'xlink:href' },
  { selector: 'use[href]', attr: 'href' },
  { selector: 'use[xlink\\:href]', attr: 'xlink:href' },
];

/** Attributes stripped in-place when they contain external URLs */
const EXTERNAL_URL_ATTR_CHECKS: ReadonlyArray<{ selector: string; attr: string }> = [
  { selector: 'video[poster]', attr: 'poster' },
  { selector: 'form[action]', attr: 'action' },
  { selector: 'button[formaction]', attr: 'formaction' },
  { selector: 'input[formaction]', attr: 'formaction' },
];

/**
 * Check if a URL string points to an external network origin (`http:`, `https:`,
 * or protocol-relative `//`).
 * @param url - The URL string to check
 * @returns true if the URL is external
 */
export function isExternalUrl(url: string): boolean {
  const normalized = url.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('//')
  );
}

/**
 * Check whether any candidate inside a `srcset` attribute points to an external URL.
 * @param srcset - Raw `srcset` attribute string
 * @returns true if at least one candidate URL is external
 */
function hasExternalSrcsetCandidate(srcset: string): boolean {
  return srcset
    .split(',')
    .some((entry) => {
      const candidateUrl = entry.trim().split(/\s+/)[0] ?? '';
      return isExternalUrl(candidateUrl);
    });
}

/**
 * Strip external `url(...)` and `@import` rules from CSS text so stylesheets
 * and inline `style` attributes cannot trigger network beacons.
 * @param cssText - Raw CSS text
 * @returns Sanitized CSS text
 */
function sanitizeCssUrls(cssText: string): string {
  const withoutExternalImports = cssText.replace(
    /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?[^;]*;?/gi,
    (fullMatch, _quote: string, target: string) => (isExternalUrl(target) ? '' : fullMatch)
  );

  return withoutExternalImports.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (fullMatch, _quote: string, target: string) => (isExternalUrl(target) ? 'url("")' : fullMatch)
  );
}

/**
 * Inject `<meta http-equiv="Content-Security-Policy">` and
 * `<meta name="referrer" content="no-referrer">` at the start of `<head>`.
 * @param doc - Parsed HTML document
 */
function enforceDocumentSecurityMeta(doc: Document): void {
  for (const existing of doc.querySelectorAll('meta[http-equiv], meta[name="referrer"]')) {
    const httpEquiv = (existing.getAttribute('http-equiv') ?? '').toLowerCase();
    const name = (existing.getAttribute('name') ?? '').toLowerCase();
    if (httpEquiv === 'content-security-policy' || name === 'referrer') {
      existing.remove();
    }
  }

  const referrerMeta = doc.createElement('meta');
  referrerMeta.setAttribute('name', 'referrer');
  referrerMeta.setAttribute('content', 'no-referrer');

  const cspMeta = doc.createElement('meta');
  cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
  cspMeta.setAttribute('content', PREVIEW_CSP_CONTENT);

  doc.head.prepend(referrerMeta);
  doc.head.prepend(cspMeta);
}

/**
 * Sanitize HTML by removing external resource tags, stripping external URLs in
 * secondary attributes/CSS, removing meta refresh directives, and injecting
 * browser-enforced CSP and no-referrer meta policies.
 * @param html - Raw HTML string to sanitize
 * @returns Sanitized HTML string with DOCTYPE preserved
 */
export function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  for (const { selector, attr } of EXTERNAL_URL_ELEMENT_CHECKS) {
    for (const el of doc.querySelectorAll(selector)) {
      const value = el.getAttribute(attr) ?? '';
      if (isExternalUrl(value)) {
        el.remove();
      }
    }
  }

  for (const { selector, attr } of EXTERNAL_URL_ATTR_CHECKS) {
    for (const el of doc.querySelectorAll(selector)) {
      const value = el.getAttribute(attr) ?? '';
      if (isExternalUrl(value)) {
        el.removeAttribute(attr);
      }
    }
  }

  for (const el of doc.querySelectorAll('[srcset]')) {
    const srcset = el.getAttribute('srcset') ?? '';
    if (hasExternalSrcsetCandidate(srcset)) {
      el.remove();
    }
  }

  for (const el of doc.querySelectorAll('[ping]')) {
    el.removeAttribute('ping');
  }

  for (const styleEl of doc.querySelectorAll('style')) {
    if (styleEl.textContent) {
      styleEl.textContent = sanitizeCssUrls(styleEl.textContent);
    }
  }

  for (const styledEl of doc.querySelectorAll('[style]')) {
    const inlineStyle = styledEl.getAttribute('style') ?? '';
    const cleaned = sanitizeCssUrls(inlineStyle);
    if (cleaned !== inlineStyle) {
      styledEl.setAttribute('style', cleaned);
    }
  }

  for (const meta of doc.querySelectorAll('meta[http-equiv]')) {
    const httpEquiv = meta.getAttribute('http-equiv') ?? '';
    if (httpEquiv.toLowerCase() === 'refresh') {
      meta.remove();
    }
  }

  enforceDocumentSecurityMeta(doc);

  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}>`
    : '<!DOCTYPE html>';
  return `${doctype}\n${doc.documentElement.outerHTML}`;
}
