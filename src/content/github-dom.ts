import type { PageType } from './types';
import { isHtmlFile, convertBlobToRawUrl, isDiffPage } from './url-utils';
import { addPreviewButtonToHeader } from './preview-button';

const PREVIEW_BUTTON_SELECTOR = '.html-preview-btn';

const FILE_HEADER_SELECTORS = [
  // New GitHub UI (CSS modules). GitHub's hashed class names have used two
  // shapes so far: `DiffFileHeader-module__diff-file-header--<hash>` and,
  // since Oct 2026, `diff-file-header__<hash>` (the `-module` infix was
  // dropped). A substring match on the stable local name covers both.
  '[class*="diff-file-header"]',
  // Legacy selectors
  '[data-tagsearch-path]',
  '.file-header[data-path]',
  '.file-header',
] as const;

/**
 * Structural fallback for the new GitHub UI, independent of hashed class
 * names: every diff block is a `div[id^="diff-"]` whose header holds an
 * `<h3>` with the file-name link (`<a href="#diff-<sha>">`). The header
 * element we hand out is the `<h3>`'s wrapper row so `insertPreviewButton`
 * can append buttons next to the file name.
 */
const DIFF_BLOCK_HEADING_SELECTOR = '[id^="diff-"] h3';
const DIFF_BLOCK_SELECTOR = '[id^="diff-"]';

const FILE_PATH_EXTRACTORS = [
  // New GitHub UI: <h3 class="...file-name..."><a><code>path/to/file</code></a></h3>
  (el: Element) => cleanPathText(el.querySelector('[class*="file-name"] code')?.textContent),
  // New GitHub UI without <code>: <h3><a href="#diff-<sha>">path/to/file</a></h3>.
  // `textContent` (not `innerText`) so off-screen blocks rendered with
  // `content-visibility: auto` still yield the path.
  (el: Element) => cleanPathText(el.querySelector('h3 a[href^="#diff-"], h3 code')?.textContent),
  // Legacy extractors
  (el: Element) => el.getAttribute('data-tagsearch-path'),
  (el: Element) => el.getAttribute('data-path'),
  (el: Element) => el.querySelector('[title]')?.getAttribute('title') ?? null,
] as const;

/**
 * Normalize file-name text copied from the DOM: strip LRM marks GitHub
 * inserts around paths and surrounding whitespace.
 * @param text - Raw text content, possibly null/undefined
 * @returns Cleaned path, or null when empty
 */
function cleanPathText(text: string | null | undefined): string | null {
  const cleaned = text?.replace(/\u200E/g, '').trim();
  return cleaned ? cleaned : null;
}

/**
 * Find all file headers in the PR Files changed tab that correspond to HTML files.
 * @returns Array of header elements for .html files
 */
export function findHtmlFileHeaders(): Element[] {
  const headers: Element[] = [];
  const seenBlocks = new Set<Element>();

  // One header per diff block: `querySelectorAll` yields document order, so
  // the outermost matching element of a block wins and nested descendants
  // that happen to share the class substring are ignored.
  const addHeader = (el: Element): void => {
    if (headers.includes(el)) return;
    const block = el.closest(DIFF_BLOCK_SELECTOR);
    if (block && seenBlocks.has(block)) return;
    const path = getFilePath(el);
    if (!path || !isHtmlFile(path)) return;
    headers.push(el);
    if (block) seenBlocks.add(block);
  };

  for (const selector of FILE_HEADER_SELECTORS) {
    for (const el of document.querySelectorAll(selector)) {
      addHeader(el);
    }
  }

  // Structural fallback: diff blocks whose header was not matched by any
  // class/attribute selector (e.g. after GitHub renames its CSS modules).
  for (const heading of document.querySelectorAll(DIFF_BLOCK_HEADING_SELECTOR)) {
    const block = heading.closest(DIFF_BLOCK_SELECTOR);
    if (!block || seenBlocks.has(block)) continue;
    const parent = heading.parentElement;
    const header =
      heading.closest('[class*="diff-file-header"]') ??
      (parent && parent !== block ? parent : heading);
    addHeader(header);
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
 * constructing a raw URL from the commit SHA in the URL (commit views) or
 * the PR's head ref and file path.
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

  const filePath = getFilePath(header);
  if (!filePath) return null;
  // Commit views pin the file to the commit SHA in the URL — check this
  // before the PR head branch so a PR Commits-tab page previews the file
  // as of that commit, not the branch tip.
  return buildRawUrlFromCommitPage(filePath) ?? buildRawUrlFromPr(filePath);
}

/**
 * Build a raw URL for a file shown on a commit diff view using the commit
 * SHA embedded in the URL. Covers both the repository commit page
 * (`/owner/repo/commit/<sha>`) and the PR Commits tab
 * (`/owner/repo/pull/<n>/commits/<sha>`).
 * @param filePath - Relative file path within the repository
 * @returns Absolute raw URL, or null when the URL is not a commit view
 */
function buildRawUrlFromCommitPage(filePath: string): string | null {
  const match = location.pathname.match(
    /^\/([^/]+\/[^/]+)\/(?:commit|pull\/\d+\/commits)\/([0-9a-f]{7,40})\b/i
  );
  if (!match) return null;
  const [, ownerRepo, sha] = match;
  return `${location.origin}/${ownerRepo}/raw/${sha}/${filePath}`;
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
  // There are two BranchName links: base (first) and head (last)
  const branchLinks = document.querySelectorAll<HTMLAnchorElement>(
    '[class*="BranchName"][href*="/tree/"], .head-ref a'
  );
  const branchLink = branchLinks[branchLinks.length - 1];
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
 * Add preview buttons to the page based on page type. Diff pages (PR
 * Files-changed and commit views) share the same per-file-header buttons.
 * @param pageType - The detected page type
 */
export function addPreviewButtons(pageType: PageType): void {
  if (isDiffPage(pageType)) {
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
