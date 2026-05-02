import { it, expect } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings-types';

// --- enableJavaScript defaults ---

it('DEFAULT_SETTINGS has enableJavaScript set to true', () => {
  expect(DEFAULT_SETTINGS.enableJavaScript).toBe(true);
});

it('normalizeSettings returns enableJavaScript true when raw has true', () => {
  const result = normalizeSettings({ enableJavaScript: true });
  expect(result.enableJavaScript).toBe(true);
});

it('normalizeSettings returns enableJavaScript false when raw has false', () => {
  const result = normalizeSettings({ enableJavaScript: false });
  expect(result.enableJavaScript).toBe(false);
});

it('normalizeSettings falls back to default when enableJavaScript is not boolean', () => {
  const result = normalizeSettings({ enableJavaScript: 'yes' });
  expect(result.enableJavaScript).toBe(true);
});

it('normalizeSettings falls back to default when enableJavaScript is missing', () => {
  const result = normalizeSettings({});
  expect(result.enableJavaScript).toBe(true);
});

// --- existing settings ---

it('normalizeSettings handles allowedRepos correctly', () => {
  const result = normalizeSettings({ allowedRepos: ['owner/repo'] });
  expect(result.allowedRepos).toEqual(['owner/repo']);
});

it('normalizeSettings handles autoPreview correctly', () => {
  const result = normalizeSettings({ autoPreview: true });
  expect(result.autoPreview).toBe(true);
});

it('normalizeSettings clamps defaultZoom within range', () => {
  const result = normalizeSettings({ defaultZoom: 300 });
  expect(result.defaultZoom).toBe(200);
});
