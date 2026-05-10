import { it, expect, beforeEach, vi } from 'vitest';
import type { ExtensionSettings } from './content/settings';

vi.mock('./content/github-dom', () => ({
  addPreviewButtons: vi.fn(),
  findHtmlFileHeaders: vi.fn(() => []),
  getRawUrl: vi.fn(),
  getBlobPageRawUrl: vi.fn(() => null),
}));

vi.mock('./content/batch-preview', () => ({
  createBatchPreviewButton: vi.fn(() => null),
}));

vi.mock('./content/inline-preview', () => ({
  createInlinePreview: vi.fn(),
  removeInlinePreview: vi.fn(),
  updateInlinePreviewContent: vi.fn(() => false),
}));

vi.mock('./content/side-panel', () => ({
  isSidePanelOpen: vi.fn(() => false),
  updateSidePanelContent: vi.fn(),
}));

vi.mock('./content/html-fetcher', () => ({
  fetchPreviewHtml: vi.fn(),
}));

vi.mock('./content/preview-tab-manager', () => ({
  hasActivePreviewTab: vi.fn(() => false),
  updatePreviewTab: vi.fn(),
  clearPreviewTab: vi.fn(),
}));

import { addPreviewButtons, findHtmlFileHeaders, getRawUrl, getBlobPageRawUrl } from './content/github-dom';
import { createInlinePreview } from './content/inline-preview';
import { fetchPreviewHtml } from './content/html-fetcher';
import { hasActivePreviewTab, updatePreviewTab, clearPreviewTab } from './content/preview-tab-manager';
import { handlePageUpdate } from './content/page-handler';
import { resetAllAutoUpdateCaches } from './content/auto-update-cache';

beforeEach(() => {
  vi.mocked(addPreviewButtons).mockReset();
  vi.mocked(findHtmlFileHeaders).mockReset();
  vi.mocked(getRawUrl).mockReset();
  vi.mocked(getBlobPageRawUrl).mockReset();
  vi.mocked(createInlinePreview).mockReset();
  vi.mocked(fetchPreviewHtml).mockReset();
  vi.mocked(hasActivePreviewTab).mockReset();
  vi.mocked(updatePreviewTab).mockReset();
  vi.mocked(clearPreviewTab).mockReset();
  resetAllAutoUpdateCaches();
  document.body.innerHTML = '';
});

const defaultSettings: ExtensionSettings = {
  allowedRepos: ['owner/repo'],
  autoPreview: false,
  defaultZoom: 100,
  enableJavaScript: true,
};

it('adds preview buttons when repo matches whitelist', () => {
  handlePageUpdate('/owner/repo/pull/1/files', defaultSettings);
  expect(addPreviewButtons).toHaveBeenCalledWith('pr-files');
});

it('does not add preview buttons when repo is not in whitelist', () => {
  handlePageUpdate('/other/repo/pull/1/files', {
    ...defaultSettings,
    allowedRepos: ['owner/repo'],
  });
  expect(addPreviewButtons).not.toHaveBeenCalled();
});

it('does not add preview buttons when whitelist is empty', () => {
  handlePageUpdate('/owner/repo/pull/1/files', {
    ...defaultSettings,
    allowedRepos: [],
  });
  expect(addPreviewButtons).not.toHaveBeenCalled();
});

it('does not add preview buttons for unknown page type', () => {
  handlePageUpdate('/owner/repo/tree/main', defaultSettings);
  expect(addPreviewButtons).not.toHaveBeenCalled();
});

it('auto-previews HTML files when autoPreview is enabled', async () => {
  const header = document.createElement('div');
  const container = document.createElement('div');
  container.id = 'diff-123';
  container.appendChild(header);
  document.body.appendChild(container);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://raw.githubusercontent.com/owner/repo/main/index.html');
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<html><body>Preview</body></html>');

  handlePageUpdate('/owner/repo/pull/1/files', {
    ...defaultSettings,
    autoPreview: true,
  });

  // Wait for async auto-preview
  await vi.waitFor(() => {
    expect(createInlinePreview).toHaveBeenCalled();
  });
});

it('passes defaultZoom to auto-preview', async () => {
  const header = document.createElement('div');
  const container = document.createElement('div');
  container.id = 'diff-456';
  container.appendChild(header);
  document.body.appendChild(container);

  vi.mocked(findHtmlFileHeaders).mockReturnValue([header]);
  vi.mocked(getRawUrl).mockReturnValue('https://raw.githubusercontent.com/owner/repo/main/index.html');
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<html><body>Zoom</body></html>');

  handlePageUpdate('/owner/repo/pull/1/files', {
    ...defaultSettings,
    autoPreview: true,
    defaultZoom: 150,
  });

  await vi.waitFor(() => {
    expect(createInlinePreview).toHaveBeenCalledWith(
      expect.anything(),
      '<html><body>Zoom</body></html>',
      150,
      true
    );
  });
});

// auto-update of preview tab on URL change

it('updates preview tab on blob-html page when active preview tab exists', () => {
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);
  vi.mocked(getBlobPageRawUrl).mockReturnValue('https://raw.githubusercontent.com/owner/repo/main/index.html');

  handlePageUpdate('/owner/repo/blob/main/index.html', defaultSettings);

  expect(updatePreviewTab).toHaveBeenCalledWith(
    'https://raw.githubusercontent.com/owner/repo/main/index.html',
    true
  );
});

it('skips updatePreviewTab when no active preview tab exists', () => {
  vi.mocked(hasActivePreviewTab).mockReturnValue(false);
  vi.mocked(getBlobPageRawUrl).mockReturnValue('https://raw.githubusercontent.com/owner/repo/main/index.html');

  handlePageUpdate('/owner/repo/blob/main/index.html', defaultSettings);

  expect(updatePreviewTab).not.toHaveBeenCalled();
});

it('skips updatePreviewTab when URL has not changed since last call', () => {
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);
  vi.mocked(getBlobPageRawUrl).mockReturnValue('https://raw.githubusercontent.com/owner/repo/main/index.html');

  handlePageUpdate('/owner/repo/blob/main/index.html', defaultSettings);
  vi.mocked(updatePreviewTab).mockClear();

  handlePageUpdate('/owner/repo/blob/main/index.html', defaultSettings);

  expect(updatePreviewTab).not.toHaveBeenCalled();
});

it('updates preview tab when URL has changed since last call', () => {
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);
  vi.mocked(getBlobPageRawUrl)
    .mockReturnValueOnce('https://raw.githubusercontent.com/owner/repo/main/a.html')
    .mockReturnValueOnce('https://raw.githubusercontent.com/owner/repo/main/b.html');

  handlePageUpdate('/owner/repo/blob/main/a.html', defaultSettings);
  vi.mocked(updatePreviewTab).mockClear();

  handlePageUpdate('/owner/repo/blob/main/b.html', defaultSettings);

  expect(updatePreviewTab).toHaveBeenCalledWith(
    'https://raw.githubusercontent.com/owner/repo/main/b.html',
    true
  );
});

it('does not call updatePreviewTab on pr-files pages', () => {
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);

  handlePageUpdate('/owner/repo/pull/1/files', defaultSettings);

  expect(updatePreviewTab).not.toHaveBeenCalled();
});

it('does not call updatePreviewTab on unknown pages', () => {
  vi.mocked(hasActivePreviewTab).mockReturnValue(true);

  handlePageUpdate('/owner/repo/tree/main', defaultSettings);

  expect(updatePreviewTab).not.toHaveBeenCalled();
});

it('auto-previews blob-html page when autoPreview is enabled', async () => {
  const container = document.createElement('div');
  container.className = 'repository-content';
  document.body.appendChild(container);

  vi.mocked(getBlobPageRawUrl).mockReturnValue('https://raw.githubusercontent.com/owner/repo/main/index.html');
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<html><body>Blob</body></html>');

  handlePageUpdate('/owner/repo/blob/main/index.html', {
    ...defaultSettings,
    autoPreview: true,
  });

  await vi.waitFor(() => {
    expect(createInlinePreview).toHaveBeenCalledWith(
      container,
      '<html><body>Blob</body></html>',
      100,
      true
    );
  });
});
