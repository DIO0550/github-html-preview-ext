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

it('falls back to the commit SHA in the URL on a commit page', () => {
  history.replaceState({}, '', '/owner/repo/commit/abc1234def');
  const el = document.createElement('div');
  el.setAttribute('data-tagsearch-path', 'dir/page.html');

  expect(getRawUrl(el)).toBe(`${location.origin}/owner/repo/raw/abc1234def/dir/page.html`);

  history.replaceState({}, '', '/');
});

it('falls back to the commit SHA in the URL on a PR Commits-tab page', () => {
  history.replaceState({}, '', '/owner/repo/pull/12/commits/abc1234def');
  const el = document.createElement('div');
  el.setAttribute('data-tagsearch-path', 'dir/page.html');

  expect(getRawUrl(el)).toBe(`${location.origin}/owner/repo/raw/abc1234def/dir/page.html`);

  history.replaceState({}, '', '/');
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

// New GitHub UI (hashed CSS-module class names, Oct 2026 format without `-module`)

const NEW_UI_BLOCK = (sha: string, path: string, blobHref: string) => `
  <div id="diff-${sha}" class="diffTargetable__jbrCub diff__GZFl4M">
    <div class="diff-file-header__NEtRX">
      <div class="file-path-section__ZYYNNI">
        <h3 class="file-name__8GKEHg">
          <a class="Link--primary" href="#diff-${sha}">‎${path}‎</a>
        </h3>
        <button aria-label="Not Viewed" aria-pressed="false" class="prc-Button-ButtonBase-9n-Xk">Viewed</button>
      </div>
      <a href="${blobHref}">View file</a>
    </div>
    <div id="diff-${sha}R1">line</div>
  </div>
`;

it('detects new-UI headers whose class names lack the -module infix', () => {
  document.body.innerHTML =
    NEW_UI_BLOCK('aaaa1111', 'docs/index.html', '/owner/repo/blob/abc/docs/index.html') +
    NEW_UI_BLOCK('bbbb2222', 'src/app.ts', '/owner/repo/blob/abc/src/app.ts');
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(1);
  expect(headers[0].className).toBe('diff-file-header__NEtRX');
  expect(getFilePath(headers[0])).toBe('docs/index.html');
});

it('still detects the previous new-UI class name format', () => {
  document.body.innerHTML = `
    <div id="diff-cccc3333">
      <div class="DiffFileHeader-module__diff-file-header--NEtRX">
        <div class="DiffFileHeader-module__file-path-section--ZYYNNI">
          <h3 class="DiffFileHeader-module__file-name--8GKEHg"><a href="#diff-cccc3333"><code>page.html</code></a></h3>
        </div>
      </div>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(1);
  expect(getFilePath(headers[0])).toBe('page.html');
});

it('falls back to the diff block <h3> structure when no known class matches', () => {
  document.body.innerHTML = `
    <div id="diff-comparison-viewer-container">
      <div id="diff-dddd4444" class="x__1">
        <div class="y__2">
          <div class="z__3">
            <h3 class="w__4"><a href="#diff-dddd4444">index.html</a></h3>
          </div>
        </div>
        <div id="diff-dddd4444R1">line</div>
      </div>
      <div id="diff-eeee5555" class="x__1">
        <div class="y__2">
          <div class="z__3">
            <h3 class="w__4"><a href="#diff-eeee5555">main.css</a></h3>
          </div>
        </div>
      </div>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(1);
  // The header handed out is the <h3>'s wrapper row (file-path-section)
  expect(headers[0].className).toBe('z__3');
  expect(getFilePath(headers[0])).toBe('index.html');
});

it('yields a single header per diff block even when nested elements share the class substring', () => {
  document.body.innerHTML = `
    <div id="diff-ffff6666">
      <div class="diff-file-header__NEtRX">
        <div class="diff-file-header-inner__abc">
          <h3 class="file-name__8GKEHg"><a href="#diff-ffff6666">index.html</a></h3>
        </div>
      </div>
    </div>
  `;
  const headers = findHtmlFileHeaders();
  expect(headers).toHaveLength(1);
  expect(headers[0].className).toBe('diff-file-header__NEtRX');
});

it('addPreviewButtons places buttons in the new-UI file-path section', () => {
  history.replaceState({}, '', '/owner/repo/pull/1/changes');
  document.body.innerHTML = NEW_UI_BLOCK(
    'aaaa1111',
    'docs/index.html',
    '/owner/repo/blob/abc/docs/index.html'
  );
  addPreviewButtons('pr-files');
  const section = document.querySelector('.file-path-section__ZYYNNI')!;
  expect(section.querySelectorAll('.html-preview-btn')).toHaveLength(3);
  // Re-running must not duplicate buttons
  addPreviewButtons('pr-files');
  expect(document.querySelectorAll('.html-preview-btn')).toHaveLength(3);
  history.replaceState({}, '', '/');
});

it('addPreviewButtons works through the structural fallback (no blob link, branch from PR header)', () => {
  history.replaceState({}, '', '/owner/repo/pull/1/changes');
  document.body.innerHTML = `
    <a class="prc-BranchName-BranchName-xyz" href="/owner/repo/tree/main">main</a>
    <a class="prc-BranchName-BranchName-xyz" href="/owner/repo/tree/feature/x">feature/x</a>
    <div id="diff-dddd4444" class="x__1">
      <div class="y__2">
        <div class="z__3">
          <h3 class="w__4"><a href="#diff-dddd4444">index.html</a></h3>
        </div>
      </div>
    </div>
  `;
  addPreviewButtons('pr-files');
  const row = document.querySelector('.z__3')!;
  expect(row.querySelectorAll('.html-preview-btn')).toHaveLength(3);
  expect(getRawUrl(row)).toBe(`${location.origin}/owner/repo/raw/feature/x/index.html`);
  history.replaceState({}, '', '/');
});
