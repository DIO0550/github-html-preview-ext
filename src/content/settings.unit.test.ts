import { it, expect, beforeEach, vi } from 'vitest';
import { loadSettings } from './settings';
import { normalizeSettings } from '../shared/settings-types';

beforeEach(() => {
  vi.mocked(chrome.storage.sync.get).mockReset();
});

// storage が空の場合にデフォルト値を返す

it('returns default settings when storage is empty', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({});

  const settings = await loadSettings();

  expect(settings).toEqual({
    allowedRepos: [],
    autoPreview: false,
    defaultZoom: 100,
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
