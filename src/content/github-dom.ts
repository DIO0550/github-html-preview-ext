import type { PageType } from './types';
import { isHtmlFile, convertBlobToRawUrl } from './url-utils';
import { addPreviewButtonToHeader } from './preview-button';

const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';

const FILE_HEADER_SELECTORS = [
  // New GitHub UI (CSS modules)
  '[class*="DiffFileHeader-module__diff-file-header"]',
  // Legacy selectors
  '[data-tagsearch-path]',
  '.file-header[data-path]',
  '.file-header',
] as const;

const FILE_PATH_EXTRACTORS = [
  // New GitHub UI: <h3 class="...file-name..."><a><code>path/to/file</code></a></h3>
  (el: Element) => el.querySelector('[class*="file-name"] code')?.textContent?.replace(/\u200E/g, '').trim() ?? null,
  // Legacy extractors
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
 * Get the raw URL from a file header.
 * Tries the legacy "View file" blob link first, then falls back to
 * constructing a raw URL from the PR's head ref and file path.
 * @param header - File header DOM element
 * @returns Raw URL string, or null if not determinable
 */
export function getRawUrl(header: Element): string | null {
  // Look for a blob link in the header itself
  const headerLink = header.querySelector('a[href*="/blob/"]') as HTMLAnchorElement | null;
  if (headerLink) return convertBlobToRawUrl(headerLink.href);

  // New GitHub UI: "View file" link lives in the kebab menu inside the diff container
  const diffContainer = header.closest('[id^="diff-"]') ?? header.parentElement;
  if (diffContainer) {
    const viewFileLink = diffContainer.querySelector('a[href*="/blob/"]') as HTMLAnchorElement | null;
    if (viewFileLink) return convertBlobToRawUrl(viewFileLink.href);
  }

  // Fallback: construct raw URL from PR head branch + file path
  const filePath = getFilePath(header);
  if (!filePath) return null;
  return buildRawUrlFromPr(filePath);
}

/**
 * Build a raw URL for a file in the current PR using the head branch name.
 * Extracts the branch from the PR summary's "from {branch}" link,
 * then constructs: /owner/repo/raw/{branch}/{path}
 * @param filePath - Relative file path within the repository
 * @returns Absolute raw URL, or null if branch not found
 */
function buildRawUrlFromPr(filePath: string): string | null {
  const match = location.pathname.match(/^\/([^/]+\/[^/]+)\/pull\//);
  if (!match) return null;
  const [, ownerRepo] = match;

  // Extract head branch from the PR summary "from {branch}" link
  const branchLink = document.querySelector<HTMLAnchorElement>(
    '[class*="BranchName"]:last-of-type, .head-ref a'
  );
  if (!branchLink) return null;
  const treeMatch = branchLink.getAttribute('href')?.match(/\/tree\/(.+)$/);
  if (!treeMatch) return null;
  const branch = treeMatch[1];

  return `${location.origin}/${ownerRepo}/raw/${branch}/${filePath}`;
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
