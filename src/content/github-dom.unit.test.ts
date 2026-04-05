import { it, expect, beforeEach } from 'vitest';
import {
  findHtmlFileHeaders,
  getFilePath,
  getRawUrl,
  isAlreadyProcessed,
  getBlobPageRawUrl,
  addPreviewButtons,
} from './github-dom';

beforeEach(() => {
  document.body.innerHTML = '';
});

// findHtmlFileHeaders

it('detects file headers with data-tagsearch-path for .html files', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="src/index.html" class="file-header">
      <a href="/owner/repo/blob/abc123/src/index.html">View file</a>
    </div>
    <div data-tagsearch-path="src/app.js" class="file-header">
      <a href="/owner/repo/blob/abc123/src/app.js">View file</a>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(1);
});

it('detects file headers with .file-header[data-path] fallback', () => {
  document.body.innerHTML = `
    <div class="file-header" data-path="page.html">
      <a href="/owner/repo/blob/abc123/page.html">View file</a>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(1);
});

it('filters out non-HTML files', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="style.css" class="file-header">
      <a href="/owner/repo/blob/abc123/style.css">View file</a>
    </div>
    <div data-tagsearch-path="script.js" class="file-header">
      <a href="/owner/repo/blob/abc123/script.js">View file</a>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(0);
});

// getFilePath

it('extracts file path from data-tagsearch-path', () => {
  const el = document.createElement('div');
  el.setAttribute('data-tagsearch-path', 'src/index.html');
  expect(getFilePath(el)).toBe('src/index.html');
});

it('extracts file path from data-path as fallback', () => {
  const el = document.createElement('div');
  el.setAttribute('data-path', 'page.html');
  expect(getFilePath(el)).toBe('page.html');
});

it('extracts file path from title attribute as fallback', () => {
  const el = document.createElement('div');
  const span = document.createElement('span');
  span.setAttribute('title', 'dir/file.html');
  el.appendChild(span);
  expect(getFilePath(el)).toBe('dir/file.html');
});

it('returns null when no path is found', () => {
  const el = document.createElement('div');
  expect(getFilePath(el)).toBeNull();
});

// getRawUrl

it('extracts raw URL from "View file" link href', () => {
  const el = document.createElement('div');
  el.innerHTML = '<a href="/owner/repo/blob/abc123/index.html">View file</a>';
  const url = getRawUrl(el);
  expect(url).toContain('/raw/');
});

it('returns null when no "View file" link exists (deleted file)', () => {
  const el = document.createElement('div');
  el.innerHTML = '<span>deleted file</span>';
  expect(getRawUrl(el)).toBeNull();
});

// isAlreadyProcessed

it('returns false when no preview button exists', () => {
  const el = document.createElement('div');
  expect(isAlreadyProcessed(el)).toBe(false);
});

it('returns true when preview button already exists', () => {
  const el = document.createElement('div');
  const btn = document.createElement('button');
  btn.className = 'html-preview-btn';
  el.appendChild(btn);
  expect(isAlreadyProcessed(el)).toBe(true);
});

// getBlobPageRawUrl

it('extracts raw URL from Raw button on blob page', () => {
  document.body.innerHTML = `
    <a data-testid="raw-button" href="/owner/repo/raw/main/index.html">Raw</a>
  `;
  const url = getBlobPageRawUrl();
  expect(url).toContain('/raw/');
});

it('returns null when no Raw button exists', () => {
  document.body.innerHTML = '<div>no raw button</div>';
  expect(getBlobPageRawUrl()).toBeNull();
});

// addPreviewButtons delegates by page type (integration-level)

it('addPreviewButtons with pr-files processes HTML file headers', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="index.html" class="file-header">
      <div class="file-actions"></div>
      <a href="/owner/repo/blob/abc123/index.html">View file</a>
    </div>
  `;
  addPreviewButtons('pr-files');
  expect(document.querySelector('.html-preview-btn')).not.toBeNull();
});

it('addPreviewButtons with blob-html adds button near Raw button', () => {
  document.body.innerHTML = `
    <a data-testid="raw-button" href="/owner/repo/raw/main/index.html">Raw</a>
  `;
  addPreviewButtons('blob-html');
  expect(document.querySelector('.html-preview-btn')).not.toBeNull();
});

it('buttons use GitHub native btn class for theme compatibility', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="index.html" class="file-header">
      <div class="file-actions"></div>
      <a href="/owner/repo/blob/abc123/index.html">View file</a>
    </div>
  `;
  addPreviewButtons('pr-files');
  const btn = document.querySelector('.html-preview-btn') as HTMLElement;
  expect(btn.classList.contains('btn')).toBe(true);
  expect(btn.classList.contains('btn-sm')).toBe(true);
});

it('addPreviewButtons skips already processed headers', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="index.html" class="file-header">
      <div class="file-actions"><button class="html-preview-btn">Preview</button></div>
      <a href="/owner/repo/blob/abc123/index.html">View file</a>
    </div>
  `;
  addPreviewButtons('pr-files');
  const buttons = document.querySelectorAll('.html-preview-btn');
  expect(buttons).toHaveLength(1);
});
