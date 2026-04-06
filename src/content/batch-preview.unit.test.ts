import { it, expect, vi, beforeEach } from 'vitest';
import { createBatchPreviewButton } from './batch-preview';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.mocked(fetch).mockReset();
});

it('creates a "Preview All HTML" button with file count', () => {
  document.body.innerHTML = `
    <div id="diff-header"></div>
    <div data-tagsearch-path="a.html" class="file-header">
      <a href="/owner/repo/blob/abc/a.html">View file</a>
    </div>
    <div data-tagsearch-path="b.html" class="file-header">
      <a href="/owner/repo/blob/abc/b.html">View file</a>
    </div>
    <div data-tagsearch-path="c.js" class="file-header">
      <a href="/owner/repo/blob/abc/c.js">View file</a>
    </div>
  `;

  const btn = createBatchPreviewButton();
  expect(btn).not.toBeNull();
  expect(btn!.textContent).toContain('Preview All HTML');
  expect(btn!.textContent).toContain('2');
});

it('returns null when no HTML files exist', () => {
  document.body.innerHTML = `
    <div data-tagsearch-path="app.js" class="file-header">
      <a href="/owner/repo/blob/abc/app.js">View file</a>
    </div>
  `;

  const btn = createBatchPreviewButton();
  expect(btn).toBeNull();
});

it('clicking the button triggers fetch for all HTML files', async () => {
  document.body.innerHTML = `
    <div id="diff-1">
      <div data-tagsearch-path="a.html" class="file-header">
        <div class="file-actions"></div>
        <a href="/owner/repo/blob/abc/a.html">View file</a>
      </div>
    </div>
    <div id="diff-2">
      <div data-tagsearch-path="b.html" class="file-header">
        <div class="file-actions"></div>
        <a href="/owner/repo/blob/abc/b.html">View file</a>
      </div>
    </div>
  `;

  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
    html: '<html><head></head><body>OK</body></html>',
    error: null,
  });

  const btn = createBatchPreviewButton();
  btn?.click();

  // Allow promises to resolve
  await vi.waitFor(() => {
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fetch-html' })
    );
  });
});
