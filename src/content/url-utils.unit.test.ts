import { it, expect, test } from 'vitest';
import { convertBlobToRawUrl, isHtmlFile, injectBaseTag, getPageType, extractOwnerRepo, matchesWhitelist } from './url-utils';

// convertBlobToRawUrl

it('converts /blob/ to /raw/ in a standard URL', () => {
  expect(convertBlobToRawUrl('https://github.com/owner/repo/blob/main/index.html'))
    .toBe('https://github.com/owner/repo/raw/main/index.html');
});

it('converts /blob/ to /raw/ for a sha-based URL', () => {
  expect(convertBlobToRawUrl('https://github.com/owner/repo/blob/abc123/path/to/file.html'))
    .toBe('https://github.com/owner/repo/raw/abc123/path/to/file.html');
});

test.each([
  ['Japanese chars', 'https://github.com/owner/repo/blob/main/日本語/ファイル.html', 'https://github.com/owner/repo/raw/main/日本語/ファイル.html'],
  ['spaces (encoded)', 'https://github.com/owner/repo/blob/main/my%20file.html', 'https://github.com/owner/repo/raw/main/my%20file.html'],
  ['special chars (#)', 'https://github.com/owner/repo/blob/main/file%23name.html', 'https://github.com/owner/repo/raw/main/file%23name.html'],
  ['relative path', '/owner/repo/blob/main/index.html', '/owner/repo/raw/main/index.html'],
])('converts /blob/ to /raw/ with %s', (_label, input, expected) => {
  expect(convertBlobToRawUrl(input)).toBe(expected);
});

it('returns null for URL without /blob/', () => {
  expect(convertBlobToRawUrl('https://github.com/owner/repo/tree/main')).toBeNull();
});

// isHtmlFile

test.each([
  ['index.html', true],
  ['page.htm', true],
  ['Page.HTML', true],
  ['file.HTM', true],
  ['script.js', false],
  ['style.css', false],
  ['readme.md', false],
])('isHtmlFile(%s) returns %s', (input, expected) => {
  expect(isHtmlFile(input)).toBe(expected);
});

// injectBaseTag

it('injects <base> tag after <head>', () => {
  const html = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>';
  const result = injectBaseTag(html, 'https://github.com/owner/repo/raw/main/dir/');
  expect(result).toContain('<base href="https://github.com/owner/repo/raw/main/dir/"');
});

it('injects <base> tag even when <head> is missing', () => {
  const html = '<html><body><p>Hello</p></body></html>';
  const result = injectBaseTag(html, 'https://example.com/');
  expect(result).toContain('<base href="https://example.com/"');
});

it('overwrites existing <base> tag', () => {
  const html = '<!DOCTYPE html><html><head><base href="http://old.com/"><title>Test</title></head><body></body></html>';
  const result = injectBaseTag(html, 'https://new.com/');
  expect(result).toContain('<base href="https://new.com/"');
  expect(result).not.toContain('http://old.com/');
});

it('preserves DOCTYPE', () => {
  const html = '<!DOCTYPE html><html><head></head><body></body></html>';
  const result = injectBaseTag(html, 'https://example.com/');
  expect(result).toMatch(/^<!DOCTYPE html>/i);
});

// getPageType

test.each([
  ['/owner/repo/pull/123/files', 'pr-files'],
  ['/owner/repo/pull/123/changes', 'pr-files'],
  ['/owner/repo/blob/main/index.html', 'blob-html'],
  ['/owner/repo/tree/main', 'unknown'],
  ['/owner/repo/pull/123', 'unknown'],
])('getPageType(%s) returns %s', (input, expected) => {
  expect(getPageType(input)).toBe(expected);
});

// extractOwnerRepo

test.each([
  ['/owner/repo/pull/123/files', 'owner/repo'],
  ['/owner/repo/blob/main/file.html', 'owner/repo'],
  ['/org-name/my-repo/pull/1/files', 'org-name/my-repo'],
])('extractOwnerRepo(%s) returns %s', (input, expected) => {
  expect(extractOwnerRepo(input)).toBe(expected);
});

test.each([
  ['/', null],
  ['/owner', null],
  ['', null],
])('extractOwnerRepo(%s) returns null', (input, expected) => {
  expect(extractOwnerRepo(input)).toBe(expected);
});

// matchesWhitelist

it('matches exact owner/repo', () => {
  expect(matchesWhitelist('owner/repo', ['owner/repo'])).toBe(true);
});

it('matches wildcard owner/*', () => {
  expect(matchesWhitelist('owner/repo', ['owner/*'])).toBe(true);
});

it('returns false when not in list', () => {
  expect(matchesWhitelist('owner/repo', ['other/repo'])).toBe(false);
});

it('returns false for empty list', () => {
  expect(matchesWhitelist('owner/repo', [])).toBe(false);
});

it('matches case-insensitively', () => {
  expect(matchesWhitelist('Owner/Repo', ['owner/repo'])).toBe(true);
  expect(matchesWhitelist('owner/repo', ['Owner/*'])).toBe(true);
});

it('does not support */* or partial wildcards', () => {
  expect(matchesWhitelist('owner/repo', ['*/*'])).toBe(false);
  expect(matchesWhitelist('owner/repo-foo', ['owner/repo-*'])).toBe(false);
});
