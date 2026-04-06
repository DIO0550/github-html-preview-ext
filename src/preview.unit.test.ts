import { it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = `
    <div id="loading">Loading preview...</div>
    <div id="error" style="display:none;"></div>
    <iframe id="preview" sandbox="allow-scripts" style="display:none;"></iframe>
  `;
});

it('writes HTML to iframe srcdoc on matching message', async () => {
  // Get the registered listener
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'test-id', html: '<html><body>Hello</body></html>', error: null },
    'test-id'
  );

  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(iframe.srcdoc).toContain('Hello');
  expect(iframe.style.display).toBe('block');
});

it('ignores messages with non-matching id', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'wrong-id', html: '<html><body>Wrong</body></html>', error: null },
    'test-id'
  );

  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(iframe.srcdoc).toBe('');
});

it('displays error when error field is present', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'test-id', html: null, error: 'Fetch failed' },
    'test-id'
  );

  const errorEl = document.getElementById('error')!;
  expect(errorEl.style.display).toBe('block');
  expect(errorEl.textContent).toBe('Fetch failed');
});
