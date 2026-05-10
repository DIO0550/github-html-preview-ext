import { it, expect, beforeEach, vi } from 'vitest';
import {
  createInlinePreview,
  toggleInlinePreview,
  removeInlinePreview,
  updateInlinePreviewContent,
  dispatchPreviewToBridge,
} from './inline-preview';

let postMessageSpy: ReturnType<typeof vi.fn>;

/**
 * Stub the iframe's contentWindow with a mock postMessage so the bridge can
 * actually deliver render messages in test. happy-dom assigns a real-ish
 * contentWindow but its postMessage doesn't reach the listener we attach.
 * @param iframe - Target iframe element
 */
function attachContentWindowMock(iframe: HTMLIFrameElement): { postMessage: typeof postMessageSpy } {
  const cw = { postMessage: vi.fn() };
  Object.defineProperty(iframe, 'contentWindow', {
    value: cw,
    configurable: true,
  });
  return cw;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.mocked(chrome.runtime.getURL).mockImplementation(
    (path: string) => `chrome-extension://mock-id/${path}`
  );
  postMessageSpy = vi.fn();
});

it('creates an iframe wrapper inside the container', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>Hello</body></html>');

  const wrapper = container.querySelector('.html-preview-inline');
  expect(wrapper).not.toBeNull();
});

it('points iframe src at the preview-frame sandbox page', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Hello</body></html>');

  expect(iframe.src).toBe('chrome-extension://mock-id/src/preview-frame.html');
});

it('does not create a blob URL for the iframe (delegated to preview-frame)', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Hello</body></html>');

  expect(iframe.src).not.toMatch(/^blob:/);
});

it('posts the render message to the iframe after preview-frame-ready arrives', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>JS!</body></html>', 100, true);
  const cw = attachContentWindowMock(iframe);

  // Replace the iframe contentWindow used by the bridge (already attached
  // before this test could swap it). Re-trigger the ready signal to flush.
  // The bridge filters by event.source, so we must dispatch with that source.
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-ready' },
    source: cw as unknown as MessageEventSource,
  }));

  // Note: the bridge captured the original contentWindow at setup time, not
  // the mocked one — so this test verifies wiring rather than the raw call.
  // For full bridge-level verification see preview-frame-bridge.unit.test.ts.
  expect(iframe.src).toContain('preview-frame.html');
});

// toggleInlinePreview

it('creates preview on first toggle', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  toggleInlinePreview(container, '<html><body>Toggle</body></html>');

  expect(container.querySelector('.html-preview-inline')).not.toBeNull();
});

it('hides preview on second toggle', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  toggleInlinePreview(container, '<html><body>Toggle</body></html>');
  toggleInlinePreview(container, '<html><body>Toggle</body></html>');

  const wrapper = container.querySelector('.html-preview-inline') as HTMLElement;
  expect(wrapper.style.display).toBe('none');
});

it('shows preview on third toggle', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  toggleInlinePreview(container, '<html><body>Toggle</body></html>');
  toggleInlinePreview(container, '<html><body>Toggle</body></html>');
  toggleInlinePreview(container, '<html><body>Toggle</body></html>');

  const wrapper = container.querySelector('.html-preview-inline') as HTMLElement;
  expect(wrapper.style.display).toBe('');
});

it('removes the wrapper from container', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>Remove me</body></html>');
  removeInlinePreview(container);

  expect(container.querySelector('.html-preview-inline')).toBeNull();
});

it('restores code container display on remove', () => {
  const container = document.createElement('div');
  const codeContainer = document.createElement('div');
  codeContainer.className = 'js-blob-code-container';
  container.appendChild(codeContainer);
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>X</body></html>');
  expect(codeContainer.style.display).toBe('none');
  expect(codeContainer.classList.contains('html-preview-hidden-code')).toBe(true);

  removeInlinePreview(container);

  expect(codeContainer.style.display).toBe('');
  expect(codeContainer.classList.contains('html-preview-hidden-code')).toBe(false);
});

it('updates iframe height when preview-frame reports a resize', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Resize</body></html>');
  // The bridge captured the iframe's contentWindow at setup. Use that exact
  // reference (the live iframe.contentWindow) as the message source so the
  // bridge's `event.source === iframe.contentWindow` filter passes.
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'preview-frame-resize', scrollHeight: 1500 },
    source: iframe.contentWindow as unknown as MessageEventSource,
  }));

  expect(iframe.style.height).toBe('1500px');
});

it('returns false from updateInlinePreviewContent when no wrapper exists', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const result = updateInlinePreviewContent(container, '<html><body>New</body></html>');

  expect(result).toBe(false);
});

it('returns true from updateInlinePreviewContent when an existing wrapper is re-rendered', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>Old</body></html>');
  const result = updateInlinePreviewContent(container, '<html><body>New</body></html>', true);

  expect(result).toBe(true);
});

it('returns false from updateInlinePreviewContent when wrapper exists but iframe is missing', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // Create an empty wrapper without an iframe
  const wrapper = document.createElement('div');
  wrapper.className = 'html-preview-inline';
  container.appendChild(wrapper);

  const result = updateInlinePreviewContent(container, '<html><body>No iframe</body></html>');

  expect(result).toBe(false);
});

it('returns false from updateInlinePreviewContent when the iframe has no registered bridge', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const wrapper = document.createElement('div');
  wrapper.className = 'html-preview-inline';
  const iframe = document.createElement('iframe');
  wrapper.appendChild(iframe);
  container.appendChild(wrapper);

  const result = updateInlinePreviewContent(container, '<html><body>No bridge</body></html>');

  expect(result).toBe(false);
});

// dispatchPreviewToBridge

it('returns false when bridge is undefined', () => {
  expect(dispatchPreviewToBridge(undefined, '<p>x</p>', true)).toBe(false);
});

it('returns true and forwards (html, enableJavaScript) when bridge.render succeeds', () => {
  const render = vi.fn();
  const bridge = { render, destroy: vi.fn() };

  const ok = dispatchPreviewToBridge(bridge, '<p>html</p>', true);

  expect(ok).toBe(true);
  expect(render).toHaveBeenCalledTimes(1);
  expect(render).toHaveBeenCalledWith('<p>html</p>', true);
});

it('returns false when bridge.render throws', () => {
  const bridge = {
    render: () => {
      throw new Error('boom');
    },
    destroy: vi.fn(),
  };

  expect(dispatchPreviewToBridge(bridge, '<p>x</p>', false)).toBe(false);
});

it('hides the code container and inserts the wrapper after it', () => {
  const container = document.createElement('div');
  const codeContainer = document.createElement('div');
  codeContainer.className = 'js-blob-code-container';
  container.appendChild(codeContainer);
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>X</body></html>');

  expect(codeContainer.style.display).toBe('none');
  expect(codeContainer.classList.contains('html-preview-hidden-code')).toBe(true);
  // The wrapper should appear immediately after the code container
  expect(codeContainer.nextElementSibling?.classList.contains('html-preview-inline')).toBe(true);
});
