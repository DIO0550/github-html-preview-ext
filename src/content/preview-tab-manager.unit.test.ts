import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('./html-fetcher', () => ({
  fetchPreviewHtml: vi.fn(),
}));

vi.mock('./auto-update-cache', () => ({
  resetLastPrFilesTabRawUrl: vi.fn(),
}));

import {
  openOrReusePreviewTab,
  updatePreviewTab,
  hasActivePreviewTab,
  clearPreviewTab,
} from './preview-tab-manager';
import { fetchPreviewHtml } from './html-fetcher';
import { resetLastPrFilesTabRawUrl } from './auto-update-cache';

beforeEach(() => {
  vi.mocked(chrome.runtime.sendMessage).mockReset();
  vi.mocked(fetchPreviewHtml).mockReset();
  vi.mocked(resetLastPrFilesTabRawUrl).mockClear();
  clearPreviewTab();
  vi.mocked(resetLastPrFilesTabRawUrl).mockClear();
});

it('sends open-preview-tab without existingTabId on first call', async () => {
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>html</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ tabId: 11, error: null });

  await openOrReusePreviewTab('https://example.com/file.html', true);

  expect(fetchPreviewHtml).toHaveBeenCalledWith('https://example.com/file.html', true);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'open-preview-tab',
    html: '<p>html</p>',
    enableJavaScript: true,
    existingTabId: null,
  }));
  expect(hasActivePreviewTab()).toBe(true);
});

it('reuses tabId on second call by passing existingTabId', async () => {
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>html</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ tabId: 11, error: null });

  await openOrReusePreviewTab('https://example.com/a.html', true);
  vi.mocked(chrome.runtime.sendMessage).mockClear();
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>second</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ tabId: 11, error: null });

  await openOrReusePreviewTab('https://example.com/b.html', true);

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'open-preview-tab',
    html: '<p>second</p>',
    existingTabId: 11,
  }));
});

it('updatePreviewTab sends update-preview when a tab is active', async () => {
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>orig</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ tabId: 22, error: null });
  await openOrReusePreviewTab('https://example.com/file.html', true);

  vi.mocked(chrome.runtime.sendMessage).mockClear();
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>updated</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true, error: null });

  await updatePreviewTab('https://example.com/other.html', false);

  expect(fetchPreviewHtml).toHaveBeenCalledWith('https://example.com/other.html', false);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'update-preview',
    tabId: 22,
    html: '<p>updated</p>',
    enableJavaScript: false,
  }));
});

it('updatePreviewTab does nothing when no tab is active', async () => {
  await updatePreviewTab('https://example.com/file.html', true);

  expect(fetchPreviewHtml).not.toHaveBeenCalled();
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

it('updatePreviewTab clears tabId when background reports tab is gone', async () => {
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>orig</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ tabId: 33, error: null });
  await openOrReusePreviewTab('https://example.com/file.html', true);
  expect(hasActivePreviewTab()).toBe(true);

  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>upd</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false, error: 'No tab with id 33' });

  await updatePreviewTab('https://example.com/other.html', true);

  expect(hasActivePreviewTab()).toBe(false);
});

it('hasActivePreviewTab reflects state', () => {
  expect(hasActivePreviewTab()).toBe(false);
});

it('clearPreviewTab resets the tabId', async () => {
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>x</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ tabId: 7, error: null });
  await openOrReusePreviewTab('https://example.com/x.html', true);
  expect(hasActivePreviewTab()).toBe(true);

  clearPreviewTab();
  expect(hasActivePreviewTab()).toBe(false);
});

it('clearPreviewTab resets the PR Files tab rawUrl tracker', () => {
  clearPreviewTab();
  expect(resetLastPrFilesTabRawUrl).toHaveBeenCalled();
});

it('openOrReusePreviewTab invokes onReady once after the tabId is cached', async () => {
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>x</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ tabId: 99, error: null });
  const onReady = vi.fn();

  await openOrReusePreviewTab('https://example.com/x.html', true, onReady);

  expect(onReady).toHaveBeenCalledTimes(1);
  expect(hasActivePreviewTab()).toBe(true);
});

it('openOrReusePreviewTab does not invoke onReady when no tabId is returned', async () => {
  vi.mocked(fetchPreviewHtml).mockResolvedValue('<p>x</p>');
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ tabId: null, error: 'denied' });
  const onReady = vi.fn();

  await openOrReusePreviewTab('https://example.com/x.html', true, onReady);

  expect(onReady).not.toHaveBeenCalled();
});
