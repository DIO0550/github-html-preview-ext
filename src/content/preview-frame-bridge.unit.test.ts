import { it, expect, vi, beforeEach } from 'vitest';
import { setupPreviewFrameBridge } from './preview-frame-bridge';

let iframe: HTMLIFrameElement;
let postMessageSpy: ReturnType<typeof vi.fn>;
let mockContentWindow: { postMessage: typeof postMessageSpy };

beforeEach(() => {
  document.body.innerHTML = '';
  iframe = document.createElement('iframe');
  document.body.appendChild(iframe);

  postMessageSpy = vi.fn();
  mockContentWindow = { postMessage: postMessageSpy };
  Object.defineProperty(iframe, 'contentWindow', {
    value: mockContentWindow,
    configurable: true,
  });
});

it('queues render until preview-frame-ready arrives, then posts to iframe', () => {
  const bridge = setupPreviewFrameBridge(iframe);

  bridge.render('<p>hi</p>', true);
  expect(postMessageSpy).not.toHaveBeenCalled();

  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-ready' },
    source: mockContentWindow as unknown as MessageEventSource,
  }));

  expect(postMessageSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-frame-render',
      html: '<p>hi</p>',
      enableJavaScript: true,
    }),
    '*'
  );
});

it('posts immediately on subsequent renders after ready', () => {
  const bridge = setupPreviewFrameBridge(iframe);

  bridge.render('<a>1</a>', true);
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-ready' },
    source: mockContentWindow as unknown as MessageEventSource,
  }));
  postMessageSpy.mockClear();

  bridge.render('<a>2</a>', false);
  expect(postMessageSpy).toHaveBeenCalledWith(
    expect.objectContaining({ html: '<a>2</a>', enableJavaScript: false }),
    '*'
  );
});

it('re-posts the last render when the iframe reloads and signals ready again', () => {
  const bridge = setupPreviewFrameBridge(iframe);
  bridge.render('<p>persist</p>', true);

  const ready = (): void => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'preview-frame-ready' },
      source: mockContentWindow as unknown as MessageEventSource,
    }));
  };

  ready();
  postMessageSpy.mockClear();

  // Simulate the iframe being detached/re-attached by GitHub's SPA re-render:
  // the reloaded frame posts a fresh ready signal.
  ready();

  expect(postMessageSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview-frame-render',
      html: '<p>persist</p>',
      enableJavaScript: true,
    }),
    '*'
  );
});

it('ignores ready signals from other windows', () => {
  const bridge = setupPreviewFrameBridge(iframe);
  bridge.render('<p>x</p>', true);

  const otherWindow = { postMessage: vi.fn() };
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-ready' },
    source: otherWindow as unknown as MessageEventSource,
  }));

  expect(postMessageSpy).not.toHaveBeenCalled();
});

it('destroy removes the message listener', () => {
  const bridge = setupPreviewFrameBridge(iframe);
  bridge.render('<p>x</p>', true);
  bridge.destroy();

  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-ready' },
    source: mockContentWindow as unknown as MessageEventSource,
  }));

  expect(postMessageSpy).not.toHaveBeenCalled();
});

it('invokes onResize callback with scrollHeight when iframe reports preview-frame-resize', () => {
  const onResize = vi.fn();
  setupPreviewFrameBridge(iframe, onResize);

  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-resize', scrollHeight: 1234 },
    source: mockContentWindow as unknown as MessageEventSource,
  }));

  expect(onResize).toHaveBeenCalledWith(1234);
});

it('does not throw when onResize is omitted and a resize message arrives', () => {
  setupPreviewFrameBridge(iframe);

  expect(() => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-resize', scrollHeight: 500 },
    source: mockContentWindow as unknown as MessageEventSource,
  }))).not.toThrow();
});

it('ignores resize messages with non-numeric scrollHeight', () => {
  const onResize = vi.fn();
  setupPreviewFrameBridge(iframe, onResize);

  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-resize', scrollHeight: 'tall' },
    source: mockContentWindow as unknown as MessageEventSource,
  }));

  expect(onResize).not.toHaveBeenCalled();
});
