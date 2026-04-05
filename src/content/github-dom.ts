import type { PageType } from './types';
import { isHtmlFile, convertBlobToRawUrl } from './url-utils';
import { addPreviewButtonToHeader } from './preview-button';

const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';

const FILE_HEADER_SELECTORS = [
  '[data-tagsearch-path]',
  '.file-header[data-path]',
  '.file-header',
] as const;

const FILE_PATH_EXTRACTORS = [
  (el: Element) => el.getAttribute('data-tagsearch-path'),
  (el: Element) => el.getAttribute('data-path'),
  (el: Element) => el.querySelector('[title]')?.getAttribute('title') ?? null,
] as const;

/**
 * Find all file headers in the PR Files changed tab that correspond to HTML files.
 * @returns Array of header elements for .html files
 */
export function findHtmlFileHeaders(): Element[] {
  const headers: Element[] = [];
  for (const selector of FILE_HEADER_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const path = getFilePath(el);
      if (path && isHtmlFile(path) && !headers.includes(el)) {
        headers.push(el);
      }
    }
  }
  return headers;
}

/**
 * Extract the file path from a header element using multiple fallback strategies.
 * @param header - File header DOM element
 * @returns File path string, or null if not found
 */
export function getFilePath(header: Element): string | null {
  for (const extractor of FILE_PATH_EXTRACTORS) {
    const path = extractor(header);
    if (path) return path;
  }
  return null;
}

/**
 * Get the raw URL from a file header's "View file" link.
 * @param header - File header DOM element
 * @returns Raw URL string, or null if no link found (e.g. deleted file)
 */
export function getRawUrl(header: Element): string | null {
  const link = header.querySelector('a[href*="/blob/"]') as HTMLAnchorElement | null;
  if (!link) return null;
  // Use .href property for absolute URL (not getAttribute which returns relative)
  return convertBlobToRawUrl(link.href);
}

/**
 * Check whether a file header already has a preview button inserted.
 * @param header - File header DOM element
 * @returns true if a preview button already exists
 */
export function isAlreadyProcessed(header: Element): boolean {
  return header.querySelector(PREVIEW_BUTTON_SELECTOR) !== null;
}

/**
 * Get the raw URL from the "Raw" button on a blob file page.
 * @returns Raw URL string, or null if no Raw button found
 */
export function getBlobPageRawUrl(): string | null {
  const rawButton = document.querySelector(
    'a[data-testid="raw-button"], a.btn-sm[href*="/raw/"]'
  ) as HTMLAnchorElement | null;
  if (!rawButton) return null;
  // Use .href property for absolute URL
  return rawButton.href || null;
}

/**
 * Add preview buttons to the page based on page type.
 * @param pageType - The detected page type ('pr-files' or 'blob-html')
 */
export function addPreviewButtons(pageType: PageType): void {
  if (pageType === 'pr-files') {
    addPreviewButtonsToPrFiles();
  } else if (pageType === 'blob-html') {
    addPreviewButtonToBlobPage();
  }
}

/** Insert preview buttons into each HTML file header on PR Files changed tab. */
function addPreviewButtonsToPrFiles(): void {
  const headers = findHtmlFileHeaders();
  for (const header of headers) {
    if (isAlreadyProcessed(header)) continue;
    const rawUrl = getRawUrl(header);
    if (!rawUrl) continue;
    addPreviewButtonToHeader(header, rawUrl);
  }
}

/** Insert a preview button next to the Raw button on a blob file page. */
function addPreviewButtonToBlobPage(): void {
  if (document.querySelector(PREVIEW_BUTTON_SELECTOR)) return;

  const rawUrl = getBlobPageRawUrl();
  if (!rawUrl) return;

  const rawButton = document.querySelector(
    'a[data-testid="raw-button"], a.btn-sm[href*="/raw/"]'
  );
  if (!rawButton?.parentElement) return;

  // Create a wrapper to act as header for addPreviewButtonToHeader
  addPreviewButtonToHeader(rawButton.parentElement, rawUrl);
}
