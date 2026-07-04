import { it, expect, vi, beforeEach } from 'vitest';

type MessageListener = (
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | undefined;

let listener: MessageListener;

beforeEach(async () => {
  vi.resetModules();
  vi.mocked(chrome.runtime.onMessage.addListener).mockReset();
  vi.mocked(chrome.tabs.query).mockReset();
  vi.mocked(chrome.tabs.create).mockReset();
  vi.mocked(chrome.tabs.update).mockReset();
  vi.mocked(chrome.tabs.get).mockReset();
  vi.mocked(chrome.tabs.sendMessage).mockReset();
  vi.mocked(chrome.runtime.getURL).mockImplementation(
    (path: string) => `chrome-extension://mock-id/${path}`
  );

  await import('./background');
  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  listener = calls[0]![0] as unknown as MessageListener;
});

const sender = {} as chrome.runtime.MessageSender;

// open-preview-tab

it('creates a new preview tab when no existing tab is provided', async () => {
  vi.mocked(chrome.tabs.create).mockImplementation(((createProps: chrome.tabs.CreateProperties) => {
    return Promise.resolve({ id: 42, url: createProps.url } as chrome.tabs.Tab);
  }) as typeof chrome.tabs.create);

  const sendResponse = vi.fn();
  listener(
    { type: 'open-preview-tab', html: '<p>hi</p>', enableJavaScript: true, existingTabId: null },
    sender,
    sendResponse
  );

  await new Promise(r => setTimeout(r, 0));
  expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
    url: expect.stringContaining('src/preview.html'),
  }));
  expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ tabId: 42, error: null }));
});

it('focuses an existing preview tab when existingTabId is provided', async () => {
  vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 99 } as chrome.tabs.Tab);
  vi.mocked(chrome.tabs.update).mockResolvedValue({ id: 99 } as chrome.tabs.Tab);
  vi.mocked(chrome.tabs.sendMessage).mockResolvedValue(undefined);

  const sendResponse = vi.fn();
  listener(
    { type: 'open-preview-tab', html: '<p>hi</p>', enableJavaScript: true, existingTabId: 99 },
    sender,
    sendResponse
  );

  // Wait two microtask ticks for chained promises to settle
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  expect(chrome.tabs.update).toHaveBeenCalledWith(99, expect.objectContaining({ active: true }));
  expect(chrome.tabs.create).not.toHaveBeenCalled();
  expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ tabId: 99, error: null }));
});

it('falls back to creating a new tab when existing tab no longer exists', async () => {
  vi.mocked(chrome.tabs.get).mockRejectedValue(new Error('No tab with id'));
  vi.mocked(chrome.tabs.create).mockImplementation(((createProps: chrome.tabs.CreateProperties) => {
    return Promise.resolve({ id: 7, url: createProps.url } as chrome.tabs.Tab);
  }) as typeof chrome.tabs.create);

  const sendResponse = vi.fn();
  listener(
    { type: 'open-preview-tab', html: '<p>hi</p>', enableJavaScript: true, existingTabId: 999 },
    sender,
    sendResponse
  );

  await new Promise(r => setTimeout(r, 0));
  expect(chrome.tabs.create).toHaveBeenCalled();
  expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ tabId: 7 }));
});

// update-preview

it('sends preview-update message to the specified tab', async () => {
  vi.mocked(chrome.tabs.sendMessage).mockResolvedValue(undefined);

  const sendResponse = vi.fn();
  listener(
    { type: 'update-preview', tabId: 5, html: '<p>new</p>', enableJavaScript: true },
    sender,
    sendResponse
  );

  await new Promise(r => setTimeout(r, 0));
  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
    5,
    expect.objectContaining({
      type: 'preview-update',
      html: '<p>new</p>',
      enableJavaScript: true,
    })
  );
  expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, error: null }));
});

it('returns an error when the preview tab no longer exists', async () => {
  vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error('No tab with id 5'));

  const sendResponse = vi.fn();
  listener(
    { type: 'update-preview', tabId: 5, html: '<p>new</p>', enableJavaScript: true },
    sender,
    sendResponse
  );

  await new Promise(r => setTimeout(r, 0));
  expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
    ok: false,
    error: expect.stringContaining('No tab'),
  }));
});

// check-preview-tab

it('returns exists=true when chrome.tabs.get resolves', async () => {
  vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 12 } as chrome.tabs.Tab);

  const sendResponse = vi.fn();
  listener({ type: 'check-preview-tab', tabId: 12 }, sender, sendResponse);

  await new Promise(r => setTimeout(r, 0));
  expect(sendResponse).toHaveBeenCalledWith({ exists: true });
});

it('returns exists=false when chrome.tabs.get rejects', async () => {
  vi.mocked(chrome.tabs.get).mockRejectedValue(new Error('No tab'));

  const sendResponse = vi.fn();
  listener({ type: 'check-preview-tab', tabId: 12 }, sender, sendResponse);

  await new Promise(r => setTimeout(r, 0));
  expect(sendResponse).toHaveBeenCalledWith({ exists: false });
});

// preview-store / preview-get

it('keeps the stored preview available for repeated preview-get calls (tab reload)', () => {
  const storeResponse = vi.fn();
  listener(
    { type: 'preview-store', id: 'abc', html: '<p>stored</p>', error: null },
    sender,
    storeResponse
  );
  expect(storeResponse).toHaveBeenCalledWith({ ok: true });

  const firstGet = vi.fn();
  listener({ type: 'preview-get', id: 'abc' }, sender, firstGet);
  expect(firstGet).toHaveBeenCalledWith(expect.objectContaining({ html: '<p>stored</p>' }));

  // A reload of the preview tab issues a second preview-get with the same
  // id — it must still resolve instead of pending until timeout.
  const secondGet = vi.fn();
  listener({ type: 'preview-get', id: 'abc' }, sender, secondGet);
  expect(secondGet).toHaveBeenCalledWith(expect.objectContaining({ html: '<p>stored</p>' }));
});

// Defensive integer guards (regression for "tabs.sendMessage: No matching signature")

it('rejects update-preview when tabId is null without invoking chrome.tabs.sendMessage', async () => {
  const sendResponse = vi.fn();
  listener(
    { type: 'update-preview', tabId: null, html: '<p>x</p>', enableJavaScript: true },
    sender,
    sendResponse
  );

  await new Promise(r => setTimeout(r, 0));
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});

it('rejects check-preview-tab when tabId is null without invoking chrome.tabs.get', async () => {
  const sendResponse = vi.fn();
  listener({ type: 'check-preview-tab', tabId: null }, sender, sendResponse);

  await new Promise(r => setTimeout(r, 0));
  expect(chrome.tabs.get).not.toHaveBeenCalled();
  expect(sendResponse).toHaveBeenCalledWith({ exists: false });
});

it('falls back to a new tab when open-preview-tab existingTabId is non-integer', async () => {
  vi.mocked(chrome.tabs.create).mockImplementation(((createProps: chrome.tabs.CreateProperties) => {
    return Promise.resolve({ id: 33, url: createProps.url } as chrome.tabs.Tab);
  }) as typeof chrome.tabs.create);

  const sendResponse = vi.fn();
  listener(
    { type: 'open-preview-tab', html: '<p>x</p>', enableJavaScript: true, existingTabId: 'abc' },
    sender,
    sendResponse
  );

  await new Promise(r => setTimeout(r, 0));
  expect(chrome.tabs.get).not.toHaveBeenCalled();
  expect(chrome.tabs.create).toHaveBeenCalled();
  expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ tabId: 33 }));
});
