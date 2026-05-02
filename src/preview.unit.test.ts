import { it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(chrome.runtime.onMessage.addListener).mockReset();
  document.body.innerHTML = `
    <div id="loading">Loading preview...</div>
    <div id="error" style="display:none;"></div>
    <iframe id="preview" sandbox="allow-scripts" style="display:none;"></iframe>
  `;
});

it('sets iframe src to blob URL on matching message', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'test-id', html: '<html><body>Hello</body></html>', error: null },
    'test-id'
  );

  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(iframe.src).toMatch(/^blob:/);
  expect(iframe.style.display).toBe('block');
});

it('ignores messages with non-matching id', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'wrong-id', html: '<html><body>Wrong</body></html>', error: null },
    'test-id'
  );

  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(iframe.src).not.toMatch(/^blob:/);
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

// preview-update message listener (continuous listening)

it('registers a chrome.runtime.onMessage listener at module load', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ html: null, error: null, pending: true });
  vi.resetModules();
  await import('./preview');
  expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
});

it('updates the iframe when a preview-update message is received', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ html: null, error: null, pending: true });
  const previewId = 'test-id-update';
  history.replaceState({}, '', `?id=${previewId}`);
  vi.resetModules();
  await import('./preview');

  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  const listener = calls[calls.length - 1]![0] as (
    msg: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r?: unknown) => void
  ) => void;

  listener(
    { type: 'preview-update', html: '<html><body>Updated</body></html>', enableJavaScript: true },
    {} as chrome.runtime.MessageSender,
    () => {}
  );

  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(iframe.src).toMatch(/^blob:/);
  expect(iframe.style.display).toBe('block');
});

it('ignores messages with non-matching type', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ html: null, error: null, pending: true });
  const previewId = 'test-id-other';
  history.replaceState({}, '', `?id=${previewId}`);
  vi.resetModules();
  await import('./preview');

  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  const listener = calls[calls.length - 1]![0] as (
    msg: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r?: unknown) => void
  ) => void;

  listener(
    { type: 'unrelated-event', html: '<p>nope</p>' },
    {} as chrome.runtime.MessageSender,
    () => {}
  );

  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(iframe.src).not.toMatch(/^blob:/);
});
