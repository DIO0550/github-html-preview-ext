import { it, expect, beforeEach } from 'vitest';
import {
  getInlinePreviewRawUrl,
  setInlinePreviewRawUrl,
  getLastPrFilesTabRawUrl,
  setLastPrFilesTabRawUrl,
  getLastPanelRawUrl,
  setLastPanelRawUrl,
  getLastBlobRawUrl,
  setLastBlobRawUrl,
  resetLastPanelRawUrl,
  resetLastPrFilesTabRawUrl,
  resetLastBlobRawUrl,
  resetAllAutoUpdateCaches,
} from './auto-update-cache';

beforeEach(() => {
  resetAllAutoUpdateCaches();
});

// inlinePreviewRawUrls

it('returns undefined for an unseen container', () => {
  const c = document.createElement('div');
  expect(getInlinePreviewRawUrl(c)).toBeUndefined();
});

it('returns the rawUrl after set', () => {
  const c = document.createElement('div');
  setInlinePreviewRawUrl(c, 'https://example.com/a.html');
  expect(getInlinePreviewRawUrl(c)).toBe('https://example.com/a.html');
});

it('keeps per-container rawUrls independent', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  setInlinePreviewRawUrl(a, 'https://example.com/a.html');
  setInlinePreviewRawUrl(b, 'https://example.com/b.html');
  expect(getInlinePreviewRawUrl(a)).toBe('https://example.com/a.html');
  expect(getInlinePreviewRawUrl(b)).toBe('https://example.com/b.html');
});

// last*RawUrl getters/setters

it('round-trips lastPrFilesTabRawUrl', () => {
  expect(getLastPrFilesTabRawUrl()).toBeNull();
  setLastPrFilesTabRawUrl('https://example.com/a.html');
  expect(getLastPrFilesTabRawUrl()).toBe('https://example.com/a.html');
});

it('round-trips lastPanelRawUrl', () => {
  expect(getLastPanelRawUrl()).toBeNull();
  setLastPanelRawUrl('https://example.com/p.html');
  expect(getLastPanelRawUrl()).toBe('https://example.com/p.html');
});

it('round-trips lastBlobRawUrl', () => {
  expect(getLastBlobRawUrl()).toBeNull();
  setLastBlobRawUrl('https://example.com/b.html');
  expect(getLastBlobRawUrl()).toBe('https://example.com/b.html');
});

// individual reset helpers do not bleed into siblings

it('resetLastPanelRawUrl clears only the panel tracker', () => {
  setLastPanelRawUrl('panel');
  setLastPrFilesTabRawUrl('tab');
  setLastBlobRawUrl('blob');

  resetLastPanelRawUrl();

  expect(getLastPanelRawUrl()).toBeNull();
  expect(getLastPrFilesTabRawUrl()).toBe('tab');
  expect(getLastBlobRawUrl()).toBe('blob');
});

it('resetLastPrFilesTabRawUrl clears only the PR Files tab tracker', () => {
  setLastPanelRawUrl('panel');
  setLastPrFilesTabRawUrl('tab');
  setLastBlobRawUrl('blob');

  resetLastPrFilesTabRawUrl();

  expect(getLastPanelRawUrl()).toBe('panel');
  expect(getLastPrFilesTabRawUrl()).toBeNull();
  expect(getLastBlobRawUrl()).toBe('blob');
});

it('resetLastBlobRawUrl clears only the blob tracker', () => {
  setLastPanelRawUrl('panel');
  setLastPrFilesTabRawUrl('tab');
  setLastBlobRawUrl('blob');

  resetLastBlobRawUrl();

  expect(getLastPanelRawUrl()).toBe('panel');
  expect(getLastPrFilesTabRawUrl()).toBe('tab');
  expect(getLastBlobRawUrl()).toBeNull();
});

// resetAllAutoUpdateCaches

it('resetAllAutoUpdateCaches drops every last*RawUrl', () => {
  setLastPanelRawUrl('panel');
  setLastPrFilesTabRawUrl('tab');
  setLastBlobRawUrl('blob');

  resetAllAutoUpdateCaches();

  expect(getLastPanelRawUrl()).toBeNull();
  expect(getLastPrFilesTabRawUrl()).toBeNull();
  expect(getLastBlobRawUrl()).toBeNull();
});

it('resetAllAutoUpdateCaches replaces the inline WeakMap so prior containers miss', () => {
  const c = document.createElement('div');
  setInlinePreviewRawUrl(c, 'https://example.com/old.html');
  expect(getInlinePreviewRawUrl(c)).toBe('https://example.com/old.html');

  resetAllAutoUpdateCaches();

  expect(getInlinePreviewRawUrl(c)).toBeUndefined();
});
