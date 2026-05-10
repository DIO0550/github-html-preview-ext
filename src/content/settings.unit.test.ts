import { it, expect, beforeEach, vi } from 'vitest';
import { loadSettings, subscribeSettingsChanges } from './settings';
import { normalizeSettings } from '../shared/settings-types';

beforeEach(() => {
  vi.mocked(chrome.storage.sync.get).mockReset();
  vi.mocked(chrome.storage.onChanged.addListener).mockReset();
  vi.mocked(chrome.storage.onChanged.removeListener).mockReset();
});

// storage が空の場合にデフォルト値を返す

it('returns default settings when storage is empty', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({});

  const settings = await loadSettings();

  expect(settings).toEqual({
    allowedRepos: [],
    autoPreview: false,
    defaultZoom: 100,
    enableJavaScript: true,
  });
});

// 保存済み設定を読み込める

it('loads saved settings from storage', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: ['owner/repo'],
    autoPreview: true,
    defaultZoom: 150,
  });

  const settings = await loadSettings();

  expect(settings).toEqual({
    allowedRepos: ['owner/repo'],
    autoPreview: true,
    defaultZoom: 150,
    enableJavaScript: true,
  });
});

// 一部の設定のみ保存されている場合、残りはデフォルト値で補完

it('merges partial saved settings with defaults', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    autoPreview: true,
  });

  const settings = await loadSettings();

  expect(settings).toEqual({
    allowedRepos: [],
    autoPreview: true,
    defaultZoom: 100,
    enableJavaScript: true,
  });
});

// storage.sync.get がエラーの場合、デフォルト値にフォールバック

it('falls back to defaults when storage.sync.get throws', async () => {
  vi.mocked(chrome.storage.sync.get).mockRejectedValue(new Error('Storage error'));

  const settings = await loadSettings();

  expect(settings).toEqual({
    allowedRepos: [],
    autoPreview: false,
    defaultZoom: 100,
    enableJavaScript: true,
  });
});

// normalizeSettings — corrupted data handling

it('normalizes corrupted allowedRepos to empty array', () => {
  const result = normalizeSettings({ allowedRepos: 'not-an-array', autoPreview: false, defaultZoom: 100 });
  expect(result.allowedRepos).toEqual([]);
});

it('filters non-string items from allowedRepos', () => {
  const result = normalizeSettings({ allowedRepos: ['valid/repo', 123, null], autoPreview: false, defaultZoom: 100 });
  expect(result.allowedRepos).toEqual(['valid/repo']);
});

it('clamps out-of-range defaultZoom', () => {
  expect(normalizeSettings({ allowedRepos: [], autoPreview: false, defaultZoom: 999 }).defaultZoom).toBe(200);
  expect(normalizeSettings({ allowedRepos: [], autoPreview: false, defaultZoom: -5 }).defaultZoom).toBe(25);
});

it('falls back defaultZoom for non-numeric values', () => {
  expect(normalizeSettings({ allowedRepos: [], autoPreview: false, defaultZoom: 'abc' }).defaultZoom).toBe(100);
});

// subscribeSettingsChanges

it('subscribeSettingsChanges registers an onChanged listener', () => {
  subscribeSettingsChanges(() => {});

  expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
});

it('unsubscribe removes the registered listener', () => {
  const unsubscribe = subscribeSettingsChanges(() => {});

  unsubscribe();

  expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
  const registered = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
  const removed = vi.mocked(chrome.storage.onChanged.removeListener).mock.calls[0][0];
  expect(removed).toBe(registered);
});

it('invokes onChange when sync storage emits a watched-key diff', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: ['x/y'],
    autoPreview: true,
    defaultZoom: 120,
    enableJavaScript: false,
  });
  const onChange = vi.fn();
  subscribeSettingsChanges(onChange);
  const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];

  listener({ enableJavaScript: { newValue: false, oldValue: true } }, 'sync');

  await vi.waitFor(() => {
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  expect(onChange).toHaveBeenCalledWith({
    allowedRepos: ['x/y'],
    autoPreview: true,
    defaultZoom: 120,
    enableJavaScript: false,
  });
});

it('does not invoke onChange when the area is not sync', async () => {
  const onChange = vi.fn();
  subscribeSettingsChanges(onChange);
  const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];

  listener({ enableJavaScript: { newValue: false, oldValue: true } }, 'local');

  // Give microtasks a chance.
  await Promise.resolve();
  expect(onChange).not.toHaveBeenCalled();
});

it('does not invoke onChange when only non-watched keys changed', async () => {
  const onChange = vi.fn();
  subscribeSettingsChanges(onChange);
  const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];

  listener({ someOtherKey: { newValue: 1, oldValue: 0 } }, 'sync');

  await Promise.resolve();
  expect(onChange).not.toHaveBeenCalled();
});
