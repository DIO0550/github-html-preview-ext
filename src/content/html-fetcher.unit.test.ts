import { it, expect, vi, beforeEach } from 'vitest';
import { fetchAndPreview, fetchPreviewHtml, buildPreviewHtml } from './html-fetcher';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(window.open).mockReset();
  vi.mocked(chrome.runtime.sendMessage).mockReset();
  vi.mocked(chrome.runtime.getURL).mockImplementation(
    (path: string) => `chrome-extension://mock-id/${path}`
  );
  vi.mocked(crypto.randomUUID).mockReturnValue('mock-uuid' as `${string}-${string}-${string}-${string}-${string}`);
});

// buildPreviewHtml

it('injects <base> tag based on raw URL directory', () => {
  const html = '<html><head></head><body>Hello</body></html>';
  const result = buildPreviewHtml('https://github.com/owner/repo/raw/main/dir/index.html', html);
  expect(result).toContain('<base href="https://github.com/owner/repo/raw/main/dir/"');
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

it('opens preview page via window.open with extension URL', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
    html: '<html><head></head><body>OK</body></html>',
    error: null,
  });

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(window.open).toHaveBeenCalledWith(
    'chrome-extension://mock-id/src/preview.html?id=mock-uuid',
    '_blank'
  );
});

it('sends preview-store message after successful fetch', async () => {
  // First call: fetch-html, Second call: preview-store
  vi.mocked(chrome.runtime.sendMessage)
    .mockResolvedValueOnce({ html: '<html><head></head><body>OK</body></html>', error: null })
    .mockResolvedValueOnce(undefined);

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-store',
      id: 'mock-uuid',
      html: expect.stringContaining('<base'),
    })
  );
});

it('sends error preview-store on fetch failure', async () => {
  vi.mocked(chrome.runtime.sendMessage)
    .mockResolvedValueOnce({ html: null, error: 'Failed to fetch' })
    .mockResolvedValueOnce(undefined);

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-store',
      id: 'mock-uuid',
      html: null,
      error: 'Fetch failed: Failed to fetch',
    })
  );
});
