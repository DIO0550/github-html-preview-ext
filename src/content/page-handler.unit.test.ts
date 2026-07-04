import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('./github-dom', () => ({
  addPreviewButtons: vi.fn(),
  findHtmlFileHeaders: vi.fn(() => []),
  getRawUrl: vi.fn(),
  getBlobPageRawUrl: vi.fn(() => null),
  getFilePath: vi.fn(),
}));

vi.mock('./batch-preview', () => ({
  createBatchPreviewButton: vi.fn(() => null),
}));

vi.mock('./inline-preview', () => ({
  createInlinePreview: vi.fn(),
  removeInlinePreview: vi.fn(),
  updateInlinePreviewContent: vi.fn(() => true),
}));

vi.mock('./html-fetcher', () => ({
  fetchPreviewHtml: vi.fn(),
}));

vi.mock('./preview-tab-manager', () => ({
  hasActivePreviewTab: vi.fn(() => false),
  updatePreviewTab: vi.fn(),
}));

vi.mock('./side-panel', () => ({
  isSidePanelOpen: vi.fn(() => false),
  updateSidePanelContent: vi.fn(),
}));

import {
  extractDiffShaFromHash,
  findActiveHeaderByHash,
  findTopmostViewportHeader,
  getActivePrFileRawUrl,
  reorderHeadersWithActiveFirst,
  handlePageUpdate,
} from './page-handler';
import {
  findHtmlFileHeaders,
  getRawUrl,
  getFilePath,
} from './github-dom';
import {
  createInlinePreview,
  removeInlinePreview,
  updateInlinePreviewContent,
} from './inline-preview';
import { fetchPreviewHtml } from './html-fetcher';
import {
  hasActivePreviewTab,
  updatePreviewTab,
} from './preview-tab-manager';
import {
  isSidePanelOpen,
  updateSidePanelContent,
} from './side-panel';
import {
  resetAllAutoUpdateCaches,
  getInlinePreviewRawUrl,
} from './auto-update-cache';

const settings = {
  allowedRepos: ['owner/repo'],
  autoPreview: true,
  defaultZoom: 100,
  enableJavaScript: true,
};

beforeEach(() => {
  vi.mocked(findHtmlFileHeaders).mockReset();
  vi.mocked(getRawUrl).mockReset();
  vi.mocked(getFilePath).mockReset();
  vi.mocked(createInlinePreview).mockReset();
  vi.mocked(removeInlinePreview).mockReset();
  vi.mocked(updateInlinePreviewContent).mockReset();
  vi.mocked(updateInlinePreviewContent).mockReturnValue(true);
  vi.mocked(fetchPreviewHtml).mockReset();
  vi.mocked(hasActivePreviewTab).mockReset();
  vi.mocked(hasActivePreviewTab).mockReturnValue(false);
  vi.mocked(updatePreviewTab).mockReset();
  vi.mocked(isSidePanelOpen).mockReset();
  vi.mocked(isSidePanelOpen).mockReturnValue(false);
  vi.mocked(updateSidePanelContent).mockReset();
  resetAllAutoUpdateCaches();
  document.body.innerHTML = '';
  history.replaceState({}, '', '/');
});

// extractDiffShaFromHash

it('extracts a 7-char SHA from #diff-<sha>', () => {
  expect(extractDiffShaFromHash('#diff-abc1234')).toBe('abc1234');
});

it('extracts a SHA when an R<n> suffix is present', () => {
  expect(extractDiffShaFromHash('#diff-abc1234R45')).toBe('abc1234');
});

it('extracts a SHA when L<n>-R<m> range is present', () => {
  expect(extractDiffShaFromHash('#diff-abc1234L10-R20')).toBe('abc1234');
});

it('returns null for hashes shorter than 7 hex characters', () => {
  expect(extractDiffShaFromHash('#diff-abc123')).toBeNull();
});

it('returns null for an empty diff hash', () => {
  expect(extractDiffShaFromHash('#diff-')).toBeNull();
});

it('returns null for an empty hash', () => {
  expect(extractDiffShaFromHash('')).toBeNull();
});

it('returns null for unrelated hashes', () => {
  expect(extractDiffShaFromHash('#commits')).toBeNull();
});

// findActiveHeaderByHash

it('returns the header whose enclosing diff container id equals diff-<sha>', () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-abc1234';
  const h = document.createElement('div');
  wrap.appendChild(h);

  expect(findActiveHeaderByHash([h], 'abc1234')).toBe(h);
});

it('returns the header whose enclosing diff container id starts with diff-<sha>', () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-abc1234extra';
  const h = document.createElement('div');
  wrap.appendChild(h);

  expect(findActiveHeaderByHash([h], 'abc1234')).toBe(h);
});

it('returns null when no header matches', () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-zzzzzzz';
  const h = document.createElement('div');
  wrap.appendChild(h);

  expect(findActiveHeaderByHash([h], 'abc1234')).toBeNull();
});

// findTopmostViewportHeader

/**
 * Stub a header's bounding rect for the `top` value.
 * @param el - Header element
 * @param top - Pseudo top value to report
 */
function stubTop(el: Element, top: number): void {
  (el as HTMLElement).getBoundingClientRect = (): DOMRect => ({
    top,
    bottom: top + 10,
    left: 0,
    right: 0,
    width: 0,
    height: 10,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as unknown as DOMRect);
}

it('picks the smallest non-negative top value', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  const c = document.createElement('div');
  stubTop(a, 200);
  stubTop(b, 50);
  stubTop(c, 800);

  expect(findTopmostViewportHeader([a, b, c])).toBe(b);
});

it('treats slightly-negative tops within the sticky offset as visible', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  stubTop(a, -30);
  stubTop(b, 100);

  expect(findTopmostViewportHeader([a, b])).toBe(a);
});

it('returns null when every header is scrolled fully above the viewport', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  stubTop(a, -500);
  stubTop(b, -200);

  expect(findTopmostViewportHeader([a, b])).toBeNull();
});

// getActivePrFileRawUrl

it('returns null when there are no headers', () => {
  vi.mocked(findHtmlFileHeaders).mockReturnValue([]);
  expect(getActivePrFileRawUrl()).toBeNull();
});

it('falls back to the first header when neither hash nor viewport works', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  stubTop(a, -500);
  stubTop(b, -500);
  vi.mocked(findHtmlFileHeaders).mockReturnValue([a, b]);
  vi.mocked(getRawUrl).mockImplementation((h) => (h === a ? 'A' : 'B'));
  history.replaceState({}, '', '/');

  expect(getActivePrFileRawUrl()).toBe('A');
});

it('uses the topmost viewport header when no hash matches', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  stubTop(a, 400);
  stubTop(b, 50);
  vi.mocked(findHtmlFileHeaders).mockReturnValue([a, b]);
  vi.mocked(getRawUrl).mockImplementation((h) => (h === a ? 'A' : 'B'));
  history.replaceState({}, '', '/');

  expect(getActivePrFileRawUrl()).toBe('B');
});

it('uses the hash-matched header when present', () => {
  const wrapA = document.createElement('div');
  wrapA.id = 'diff-aaaaaa1';
  const a = document.createElement('div');
  wrapA.appendChild(a);
  const wrapB = document.createElement('div');
  wrapB.id = 'diff-bbbbbb2';
  const b = document.createElement('div');
  wrapB.appendChild(b);
  document.body.append(wrapA, wrapB);
  stubTop(a, 100);
  stubTop(b, 50);
  vi.mocked(findHtmlFileHeaders).mockReturnValue([a, b]);
  vi.mocked(getRawUrl).mockImplementation((h) => (h === a ? 'A' : 'B'));
  history.replaceState({}, '', '/#diff-aaaaaa1');

  expect(getActivePrFileRawUrl()).toBe('A');
});

it('returns the same rawUrl on repeated calls (deterministic)', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  stubTop(a, 50);
  stubTop(b, 200);
  vi.mocked(findHtmlFileHeaders).mockReturnValue([a, b]);
  vi.mocked(getRawUrl).mockImplementation((h) => (h === a ? 'A' : 'B'));

  expect(getActivePrFileRawUrl()).toBe(getActivePrFileRawUrl());
});

// reorderHeadersWithActiveFirst

it('moves the active header to the front', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  const c = document.createElement('div');
  const urls = new Map<Element, string>([[a, 'A'], [b, 'B'], [c, 'C']]);
  vi.mocked(getRawUrl).mockImplementation((h) => urls.get(h) ?? null);

  const out = reorderHeadersWithActiveFirst([a, b, c], 'B');

  expect(out).toEqual([b, a, c]);
});

it('keeps the original order when activeUrl is null', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  const out = reorderHeadersWithActiveFirst([a, b], null);
  expect(out).toEqual([a, b]);
});

it('keeps the original order when the activeUrl is not in the list', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  vi.mocked(getRawUrl).mockReturnValue('A');
  const out = reorderHeadersWithActiveFirst([a, b], 'NOPE');
  expect(out).toEqual([a, b]);
});

// handlePageUpdate — PR Files-changed external sync

it('updatePreviewTab is called with the active rawUrl when a tab is open on pr-files', () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-active1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/active.html');
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);

  handlePageUpdate('/owner/repo/pull/1/files', settings);

  expect(updatePreviewTab).toHaveBeenCalledWith('https://example.com/active.html', true);
});

it('does not re-call updatePreviewTab on the same rawUrl', () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-active1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/active.html');
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);

  handlePageUpdate('/owner/repo/pull/1/files', settings);
  vi.mocked(updatePreviewTab).mockClear();
  handlePageUpdate('/owner/repo/pull/1/files', settings);

  expect(updatePreviewTab).not.toHaveBeenCalled();
});

it('updates the side panel content when the panel is open and rawUrl changed', async () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-active1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/active.html');
  vi.mocked(getFilePath).mockReturnValue('active.html');
  vi.mocked(isSidePanelOpen).mockReturnValue(true);
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>active</p>');

  handlePageUpdate('/owner/repo/pull/1/files', settings);

  await vi.waitFor(() => {
    expect(updateSidePanelContent).toHaveBeenCalledWith('<p>active</p>', 'active.html');
  });
});

it('does not update the side panel when it is closed', async () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-active1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/active.html');
  vi.mocked(getFilePath).mockReturnValue('active.html');
  vi.mocked(isSidePanelOpen).mockReturnValue(false);
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>active</p>');

  handlePageUpdate('/owner/repo/pull/1/files', settings);

  await Promise.resolve();
  expect(updateSidePanelContent).not.toHaveBeenCalled();
});

it('syncs the preview tab on a commit page', () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-active1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/commit-file.html');
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);

  handlePageUpdate('/owner/repo/commit/abc1234', settings);

  expect(updatePreviewTab).toHaveBeenCalledWith('https://example.com/commit-file.html', true);
});

it('auto-previews HTML files on a PR Commits-tab page', async () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/x.html');
  vi.mocked(updateInlinePreviewContent).mockReturnValue(false);
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>x</p>');

  handlePageUpdate('/owner/repo/pull/1/commits/abc1234', settings);

  await vi.waitFor(() => {
    expect(createInlinePreview).toHaveBeenCalled();
  });
});

it('re-syncs the preview tab after visiting a non-files page (caches cleared on leave)', () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-active1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/active.html');
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);

  handlePageUpdate('/owner/repo/pull/1/files', settings);
  vi.mocked(updatePreviewTab).mockClear();

  // Leave to the PR Conversation tab ('unknown' page type), then come back.
  handlePageUpdate('/owner/repo/pull/1', settings);
  handlePageUpdate('/owner/repo/pull/1/files', settings);

  expect(updatePreviewTab).toHaveBeenCalledWith('https://example.com/active.html', true);
});

it('drops a stale panel fetch that resolves after a newer file switch', async () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-active1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getFilePath).mockReturnValue('file.html');
  vi.mocked(isSidePanelOpen).mockReturnValue(true);
  const noAutoSettings = { ...settings, autoPreview: false };

  // File A: fetch stays pending until after file B has rendered.
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/a.html');
  let resolveA: (v: string) => void = () => {};
  vi.mocked(fetchPreviewHtml).mockImplementationOnce(
    () => new Promise<string>((resolve) => { resolveA = resolve; })
  );
  handlePageUpdate('/owner/repo/pull/1/files', noAutoSettings);

  // Switch to file B: its fetch resolves immediately.
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/b.html');
  vi.mocked(fetchPreviewHtml).mockResolvedValueOnce('<p>B</p>');
  handlePageUpdate('/owner/repo/pull/1/files', noAutoSettings);

  await vi.waitFor(() => {
    expect(updateSidePanelContent).toHaveBeenCalledWith('<p>B</p>', 'file.html');
  });
  vi.mocked(updateSidePanelContent).mockClear();

  // File A's slow fetch finally resolves — it must NOT overwrite B.
  resolveA('<p>A</p>');
  await Promise.resolve();
  await Promise.resolve();

  expect(updateSidePanelContent).not.toHaveBeenCalled();
});

// autoPreviewContainer fallback path

it('falls back to remove + create when updateInlinePreviewContent returns false', async () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  // Pretend an existing wrapper is present so updateInlinePreviewContent runs.
  const inlineWrapper = document.createElement('div');
  inlineWrapper.className = 'html-preview-inline';
  wrap.appendChild(inlineWrapper);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/x.html');
  vi.mocked(updateInlinePreviewContent).mockReturnValue(false);
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>x</p>');

  handlePageUpdate('/owner/repo/pull/1/files', settings);

  await vi.waitFor(() => {
    expect(removeInlinePreview).toHaveBeenCalled();
    expect(createInlinePreview).toHaveBeenCalled();
  });
});

it('records the rawUrl in the inline cache after a successful render', async () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/x.html');
  vi.mocked(updateInlinePreviewContent).mockReturnValue(false);
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>x</p>');

  handlePageUpdate('/owner/repo/pull/1/files', settings);

  await vi.waitFor(() => {
    expect(getInlinePreviewRawUrl(wrap)).toBe('https://example.com/x.html');
  });
});

it('does not render when the container detached during fetch', async () => {
  const wrap = document.createElement('div');
  wrap.id = 'diff-1';
  const header = document.createElement('div');
  wrap.appendChild(header);
  document.body.appendChild(wrap);
  stubTop(header, 50);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://example.com/x.html');
  vi.mocked(updateInlinePreviewContent).mockReturnValue(false);
  let resolveFetch: (v: string) => void = () => {};
  vi.mocked(fetchPreviewHtml).mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveFetch = resolve;
      })
  );

  handlePageUpdate('/owner/repo/pull/1/files', settings);

  // Detach the container before the fetch resolves.
  wrap.remove();
  resolveFetch('<p>x</p>');
  await Promise.resolve();
  await Promise.resolve();

  expect(removeInlinePreview).not.toHaveBeenCalled();
  expect(createInlinePreview).not.toHaveBeenCalled();
});
