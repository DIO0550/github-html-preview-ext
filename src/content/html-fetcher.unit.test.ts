import { it, expect, vi, beforeEach } from 'vitest';
import { fetchAndPreview, fetchPreviewHtml, buildPreviewHtml } from './html-fetcher';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fetch).mockReset();
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

// fetchPreviewHtml

it('fetches HTML with credentials include', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html><head></head><body>OK</body></html>'));

  await fetchPreviewHtml('https://github.com/owner/repo/raw/main/index.html');

  expect(fetch).toHaveBeenCalledWith(
    'https://github.com/owner/repo/raw/main/index.html',
    { credentials: 'include' }
  );
});

it('returns HTML with <base> tag injected', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html><head></head><body>OK</body></html>'));

  const result = await fetchPreviewHtml('https://github.com/owner/repo/raw/main/dir/index.html');

  expect(result).toContain('<base href="https://github.com/owner/repo/raw/main/dir/"');
});

// fetchAndPreview

it('opens preview page via window.open with extension URL', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html><head></head><body>OK</body></html>'));

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(window.open).toHaveBeenCalledWith(
    'chrome-extension://mock-id/src/preview.html?id=mock-uuid',
    '_blank'
  );
});

it('sends preview-store message via chrome.runtime.sendMessage after fetch', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('<html><head></head><body>OK</body></html>'));

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-store',
      id: 'mock-uuid',
      html: expect.stringContaining('<base'),
    })
  );
});

it('calls window.open before fetch (synchronous popup)', async () => {
  const callOrder: string[] = [];
  vi.mocked(window.open).mockImplementation(() => {
    callOrder.push('open');
    return null;
  });
  vi.mocked(fetch).mockImplementation(() => {
    callOrder.push('fetch');
    return Promise.resolve(new Response('<html><head></head><body></body></html>'));
  });

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(callOrder[0]).toBe('open');
  expect(callOrder[1]).toBe('fetch');
});

// Error handling

it('sends error message on network failure', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('Failed to fetch'));

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

it('sends error message on 401 response', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 401 }));

  await fetchAndPreview('https://github.com/owner/repo/raw/main/index.html');

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-store',
      html: null,
      error: expect.stringContaining('401'),
    })
  );
});

it('throws on non-ok response in fetchPreviewHtml', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('Forbidden', { status: 403 }));

  await expect(fetchPreviewHtml('https://github.com/owner/repo/raw/main/index.html'))
    .rejects.toThrow('HTTP 403');
});
