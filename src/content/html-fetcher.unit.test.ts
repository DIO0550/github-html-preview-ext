import { it, expect, vi, beforeEach } from 'vitest';
import { fetchAndPreview, fetchPreviewHtml, buildPreviewHtml } from './html-fetcher';
import { clearPreviewTab } from './preview-tab-manager';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(window.open).mockReset();
  vi.mocked(chrome.runtime.sendMessage).mockReset();
  vi.mocked(chrome.runtime.getURL).mockImplementation(
    (path: string) => `chrome-extension://mock-id/${path}`
  );
  vi.mocked(crypto.randomUUID).mockReturnValue('mock-uuid' as `${string}-${string}-${string}-${string}-${string}`);
  clearPreviewTab();
});

// buildPreviewHtml

it('injects <base> tag based on raw URL directory', () => {
  const html = '<html><head></head><body>Hello</body></html>';
  const result = buildPreviewHtml('https://github.com/owner/repo/raw/main/dir/index.html', html);
  expect(result).toContain('<base href="https://github.com/owner/repo/raw/main/dir/"');
});

it('applies HTML sanitizer to remove external resource tags', () => {
  const html = '<html><head></head><body><img src="https://evil.com/track.png"><p>OK</p></body></html>';
  const result = buildPreviewHtml('https://github.com/owner/repo/raw/main/index.html', html);
  expect(result).not.toContain('evil.com');
  expect(result).toContain('OK');
});

it('injects security sandbox when enableJavaScript is true', () => {
  const html = '<html><head></head><body>Hello</body></html>';
  const result = buildPreviewHtml('https://github.com/owner/repo/raw/main/index.html', html, true);
  expect(result).toContain('[HTML Preview Sandbox]');
});

it('does not inject security sandbox when enableJavaScript is false', () => {
  const html = '<html><head></head><body>Hello</body></html>';
  const result = buildPreviewHtml('https://github.com/owner/repo/raw/main/index.html', html, false);
  expect(result).not.toContain('[HTML Preview Sandbox]');
});

it('applies sanitizer regardless of enableJavaScript setting', () => {
  const html = '<html><head></head><body><img src="https://evil.com/x.png">OK</body></html>';
  const result = buildPreviewHtml('https://github.com/owner/repo/raw/main/index.html', html, false);
  expect(result).not.toContain('evil.com');
  expect(result).toContain('OK');
});

// fetchPreviewHtml (via background fetch-html message)

it('sends fetch-html message to background', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
    html: '<html><head></head><body>OK</body></html>',
    error: null,
  });

  await fetchPreviewHtml('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: 'fetch-html',
    url: 'https://github.com/owner/repo/raw/main/index.html',
  });
});

it('returns HTML with <base> tag injected', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
    html: '<html><head></head><body>OK</body></html>',
    error: null,
  });

  const result = await fetchPreviewHtml('https://github.com/owner/repo/raw/main/dir/index.html');

  expect(result).toContain('<base href="https://github.com/owner/repo/raw/main/dir/"');
});

it('throws when background returns error', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
    html: null,
    error: 'HTTP 403',
  });

  await expect(fetchPreviewHtml('https://github.com/owner/repo/raw/main/index.html'))
    .rejects.toThrow('HTTP 403');
});

// fetchAndPreview

it('does not call window.open (delegates to preview-tab-manager via background)', async () => {
  vi.mocked(chrome.runtime.sendMessage)
    .mockResolvedValueOnce({ html: '<html><head></head><body>OK</body></html>', error: null })
    .mockResolvedValueOnce({ tabId: 1, error: null });

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(window.open).not.toHaveBeenCalled();
});

it('sends open-preview-tab message with built HTML', async () => {
  vi.mocked(chrome.runtime.sendMessage)
    .mockResolvedValueOnce({ html: '<html><head></head><body>OK</body></html>', error: null })
    .mockResolvedValueOnce({ tabId: 1, error: null });

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'open-preview-tab',
      html: expect.stringContaining('<base'),
      enableJavaScript: true,
      existingTabId: null,
    })
  );
});
