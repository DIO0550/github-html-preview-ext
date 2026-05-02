import { it, expect, vi, beforeEach } from 'vitest';

let postMessageSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(chrome.runtime.onMessage.addListener).mockReset();
  document.body.innerHTML = `
    <div id="loading">Loading preview...</div>
    <div id="error" style="display:none;"></div>
    <iframe id="preview" src="" style="display:none;"></iframe>
  `;
  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  postMessageSpy = vi.fn();
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage: postMessageSpy },
    configurable: true,
  });

  const { resetPreviewFrameState } = await import('./preview-message-handler');
  resetPreviewFrameState();
});

it('queues render until preview-frame-ready arrives, then posts to iframe', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'test-id', html: '<html><body>Hello</body></html>', error: null },
    'test-id'
  );
  expect(postMessageSpy).not.toHaveBeenCalled();

  window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview-frame-ready' } }));

  expect(postMessageSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-frame-render',
      html: '<html><body>Hello</body></html>',
      enableJavaScript: true,
    }),
    '*'
  );
});

it('sends render immediately on subsequent calls after frame is ready', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'test-id', html: '<a>first</a>', error: null },
    'test-id'
  );
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview-frame-ready' } }));
  postMessageSpy.mockClear();

  handlePreviewMessage(
    { type: 'preview-update', id: 'test-id', html: '<a>second</a>', error: null, enableJavaScript: false },
    'test-id'
  );

  expect(postMessageSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-frame-render',
      html: '<a>second</a>',
      enableJavaScript: false,
    }),
    '*'
  );
});

it('hides loading and shows iframe when html arrives', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'test-id', html: '<p>x</p>', error: null },
    'test-id'
  );

  const loading = document.getElementById('loading') as HTMLDivElement;
  const iframe = document.getElementById('preview') as HTMLIFrameElement;
  expect(loading.style.display).toBe('none');
  expect(iframe.style.display).toBe('block');
});

it('ignores messages with non-matching id', async () => {
  const { handlePreviewMessage } = await import('./preview-message-handler');

  handlePreviewMessage(
    { type: 'preview-get-response', id: 'wrong-id', html: '<html><body>Wrong</body></html>', error: null },
    'test-id'
  );
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview-frame-ready' } }));

  expect(postMessageSpy).not.toHaveBeenCalled();
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
  expect(postMessageSpy).not.toHaveBeenCalled();
});

// preview.ts integration: continuous listening for preview-update

it('registers a chrome.runtime.onMessage listener at module load', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ html: null, error: null, pending: true });
  vi.resetModules();
  await import('./preview');
  expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
});

it('forwards preview-update messages to the embedded preview-frame iframe', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ html: null, error: null, pending: true });
  const previewId = 'test-id-update';
  history.replaceState({}, '', `?id=${previewId}`);
  vi.resetModules();
  // Also reset module state since we're re-importing
  const { resetPreviewFrameState } = await import('./preview-message-handler');
  resetPreviewFrameState();
  await import('./preview');

  // Simulate ready signal so the queue flushes immediately
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview-frame-ready' } }));

  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  const listener = calls[calls.length - 1]![0] as (
    msg: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r?: unknown) => void
  ) => void;

  postMessageSpy.mockClear();
  listener(
    { type: 'preview-update', html: '<html><body>Updated</body></html>', enableJavaScript: true },
    {} as chrome.runtime.MessageSender,
    () => {}
  );

  expect(postMessageSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-frame-render',
      html: '<html><body>Updated</body></html>',
    }),
    '*'
  );
});

it('ignores non-preview-update messages from chrome.runtime.onMessage', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ html: null, error: null, pending: true });
  const previewId = 'test-id-other';
  history.replaceState({}, '', `?id=${previewId}`);
  vi.resetModules();
  const { resetPreviewFrameState } = await import('./preview-message-handler');
  resetPreviewFrameState();
  await import('./preview');

  window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview-frame-ready' } }));

  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  const listener = calls[calls.length - 1]![0] as (
    msg: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r?: unknown) => void
  ) => void;

  postMessageSpy.mockClear();
  listener(
    { type: 'unrelated-event', html: '<p>nope</p>' },
    {} as chrome.runtime.MessageSender,
    () => {}
  );

  expect(postMessageSpy).not.toHaveBeenCalled();
});
