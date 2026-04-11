import { it, expect, beforeEach } from 'vitest';
import { applyZoom } from './zoom-control';
import {
  createInlinePreview,
  toggleInlinePreview,
  removeInlinePreview,
} from './inline-preview';

// Test standard patterns (see implementation-plan.md §5.2 / tasks.md テスト標準パターン):
// - Pattern A: fake contentDocument injection
// - Pattern B: scrollHeight getter swap on the same fake doc
// - Pattern C: throwing contentDocument getter (cross-origin)
// - Pattern D: createInlinePreview → attach fake doc → dispatch load
// - Pattern E: MockMutationObserver install/uninstall (per-test only)

interface FakeDoc extends Document {
  body: HTMLElement;
}

/**
 * Create a fake Document with a real body and a controllable scrollHeight.
 * @param scrollHeight - Initial scrollHeight value
 * @returns An object containing the fake doc and a setter to mutate scrollHeight
 */
function createMutableFakeDoc(scrollHeight: number = 500): {
  doc: FakeDoc;
  setScrollHeight: (n: number) => void;
} {
  let current = scrollHeight;
  const body = document.createElement('body');
  const documentElement = {
    get scrollHeight(): number {
      return current;
    },
  };
  const doc = { body, documentElement } as unknown as FakeDoc;
  return {
    doc,
    setScrollHeight: (n: number): void => {
      current = n;
    },
  };
}

/**
 * Create a simple fake doc without mutation control (for cases that don't
 * need to change scrollHeight after load).
 * @param scrollHeight - scrollHeight value
 * @returns A fake document
 */
function createFakeDoc(scrollHeight: number = 500): FakeDoc {
  return createMutableFakeDoc(scrollHeight).doc;
}

/**
 * Attach a fake contentDocument getter to an iframe.
 * @param iframe - Target iframe
 * @param doc - Fake document to expose
 */
function attachFakeDoc(iframe: HTMLIFrameElement, doc: Document): void {
  Object.defineProperty(iframe, 'contentDocument', {
    configurable: true,
    get: () => doc,
  });
}

/**
 * Attach a contentDocument getter that throws (cross-origin simulation).
 * @param iframe - Target iframe
 */
function attachThrowingContentDocument(iframe: HTMLIFrameElement): void {
  Object.defineProperty(iframe, 'contentDocument', {
    configurable: true,
    get: () => {
      throw new Error('cross-origin');
    },
  });
}

// --- Pattern E: MockMutationObserver ---

interface ObserveCall {
  target: Node;
  options: MutationObserverInit;
  observer: MockMutationObserver;
}

let observeCalls: ObserveCall[] = [];
let mockObservers: MockMutationObserver[] = [];

/**
 * Minimal stand-in for MutationObserver that records observe/disconnect
 * calls and lets tests fire the callback manually.
 */
class MockMutationObserver {
  public callback: MutationCallback;
  public observed: Array<{ target: Node; options: MutationObserverInit }> = [];
  public disconnected = false;

  /**
   * @param callback - The MutationCallback the production code passes in
   */
  constructor(callback: MutationCallback) {
    this.callback = callback;
    mockObservers.push(this);
  }

  /**
   * @param target - Node to observe
   * @param options - Observe options
   */
  observe(target: Node, options: MutationObserverInit = {}): void {
    this.observed.push({ target, options });
    observeCalls.push({ target, options, observer: this });
  }

  /** Mark this mock as disconnected. */
  disconnect(): void {
    this.disconnected = true;
  }

  /**
   * @returns Always an empty array (no real records)
   */
  takeRecords(): MutationRecord[] {
    return [];
  }

  /**
   * Fire the registered callback manually.
   * @param records - Records to pass to the callback
   */
  trigger(records: MutationRecord[] = []): void {
    this.callback(records, this as unknown as MutationObserver);
  }
}

/**
 * Replace the global MutationObserver with MockMutationObserver. Must be
 * uninstalled with `uninstallMockMutationObserver` in a `finally` block.
 * @returns The original MutationObserver constructor
 */
function installMockMutationObserver(): typeof MutationObserver {
  const original = globalThis.MutationObserver;
  observeCalls = [];
  mockObservers = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;
  return original;
}

/**
 * Restore the original MutationObserver constructor.
 * @param original - The constructor returned by installMockMutationObserver
 */
function uninstallMockMutationObserver(original: typeof MutationObserver): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MutationObserver = original;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// --- basic structural tests (DOM wiring) ---

it('creates an iframe wrapper inside the container', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>Hello</body></html>');

  const wrapper = container.querySelector('.html-preview-inline');
  expect(wrapper).not.toBeNull();
});

it('sets iframe srcdoc to the provided HTML', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Hello</body></html>');

  expect(iframe.srcdoc).toContain('Hello');
});

it('sets iframe sandbox to allow-scripts', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body></body></html>');

  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
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

it('clears iframe srcdoc before removal', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Clear me</body></html>');
  removeInlinePreview(container);

  expect(iframe.srcdoc).toBe('');
});

// --- zoom integration (replacing legacy transform assertions) ---

it('creates zoom control in the toolbar when defaultZoom is provided', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>Zoom</body></html>', 150);

  const zoomControl = container.querySelector('.html-preview-zoom-control');
  expect(zoomControl).not.toBeNull();
});

it('applies default zoom to body.style.zoom after load (150%)', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Zoom</body></html>', 150);
  const doc = createFakeDoc(500);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));

  expect(doc.body.style.zoom).toBe('1.5');
});

it('defaults to 100% body.style.zoom after load when no defaultZoom provided', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>No zoom</body></html>');
  const doc = createFakeDoc(500);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));

  expect(doc.body.style.zoom).toBe('1');
});

// --- 機能単位 0: load listener order (synthetic defaultZoom=50 case) ---

it('registers zoom-control load listener before setupAutoResize listener (defaultZoom=50)', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Order</body></html>', 50);
  const doc = createFakeDoc(500);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));

  // zoom-control's load listener must fire first (so body.zoom='0.5' is set),
  // then syncHeight reads body.zoom and writes 500/0.5 = 1000px.
  expect(doc.body.style.zoom).toBe('0.5');
  expect(iframe.style.height).toBe('1000px');
  expect(iframe.dataset.htmlPreviewBaseHeight).toBe('1000');
});

// --- 機能単位 2: initial height calculation ---

it('calculates base height from scrollHeight on initial load (scale=1)', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
  const doc = createFakeDoc(500);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));

  expect(iframe.style.height).toBe('500px');
  expect(iframe.dataset.htmlPreviewBaseHeight).toBe('500');
});

// --- 機能単位 3: zoom reduction — outer height stays at 500 (async) ---

it('keeps outer height unchanged when zoom shrinks (50%)', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
  const { doc, setScrollHeight } = createMutableFakeDoc(500);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));
  expect(iframe.style.height).toBe('500px');

  // Simulate content shrinking when body.zoom=0.5 is applied:
  setScrollHeight(250);
  applyZoom(iframe, 50); // sets doc.body.style.zoom='0.5' → attribute mutation
  await Promise.resolve();

  expect(doc.body.style.zoom).toBe('0.5');
  expect(iframe.style.height).toBe('500px'); // 250 / 0.5 = 500
});

// --- 機能単位 4: zoom expansion — outer height stays at 500 (async) ---

it('keeps outer height unchanged when zoom expands (200%)', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
  const { doc, setScrollHeight } = createMutableFakeDoc(500);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));
  expect(iframe.style.height).toBe('500px');

  setScrollHeight(1000);
  applyZoom(iframe, 200);
  await Promise.resolve();

  expect(doc.body.style.zoom).toBe('2');
  expect(iframe.style.height).toBe('500px'); // 1000 / 2 = 500
});

// --- 機能単位 5: content change (no zoom) — outer height tracks content ---

it('tracks content height when scale=1 and content grows', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
  const { doc, setScrollHeight } = createMutableFakeDoc(500);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));
  expect(iframe.style.height).toBe('500px');

  setScrollHeight(800);
  doc.body.appendChild(document.createElement('div')); // childList mutation
  await Promise.resolve();

  expect(iframe.style.height).toBe('800px');
});

// --- 機能単位 6: MutationObserver options (Pattern E) ---

it('sets MutationObserver options to {childList, subtree, attributes}', () => {
  const original = installMockMutationObserver();
  try {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
    const doc = createFakeDoc(500);
    attachFakeDoc(iframe, doc);
    iframe.dispatchEvent(new Event('load'));

    expect(observeCalls.length).toBe(1);
    expect(observeCalls[0].options.childList).toBe(true);
    expect(observeCalls[0].options.subtree).toBe(true);
    expect(observeCalls[0].options.attributes).toBe(true);
    expect(observeCalls[0].target).toBe(doc.body);
  } finally {
    uninstallMockMutationObserver(original);
  }
});

// --- 機能単位 7: cross-origin guard on load ---

it('does not throw on load when contentDocument getter throws', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
  attachThrowingContentDocument(iframe);

  expect(() => iframe.dispatchEvent(new Event('load'))).not.toThrow();
});

it('recovers after cross-origin load when a fake doc is later attached and load refired', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
  attachThrowingContentDocument(iframe);
  iframe.dispatchEvent(new Event('load'));

  const doc = createFakeDoc(500);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));

  expect(iframe.style.height).toBe('500px');
});

// --- 機能単位 8: cross-origin guard on applyZoom ---

it('does not throw when applyZoom is called while contentDocument throws', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
  attachThrowingContentDocument(iframe);

  expect(() => applyZoom(iframe, 150)).not.toThrow();
  expect(iframe.dataset.htmlPreviewZoom).toBe('1.5');
});

// --- 機能単位 9: MutationObserver lifecycle (previous observer disconnected) ---

it('disconnects previous observer on load re-fire and observes the new body', () => {
  const original = installMockMutationObserver();
  try {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
    const docA = createFakeDoc(500);
    attachFakeDoc(iframe, docA);
    iframe.dispatchEvent(new Event('load'));

    expect(mockObservers.length).toBe(1);
    expect(mockObservers[0].disconnected).toBe(false);
    expect(observeCalls[0].target).toBe(docA.body);

    const docB = createFakeDoc(800);
    attachFakeDoc(iframe, docB);
    iframe.dispatchEvent(new Event('load'));

    expect(mockObservers.length).toBe(2);
    expect(mockObservers[0].disconnected).toBe(true);
    expect(mockObservers[1].disconnected).toBe(false);
    expect(observeCalls[1].target).toBe(docB.body);
    expect(observeCalls[1].options.childList).toBe(true);
    expect(observeCalls[1].options.subtree).toBe(true);
    expect(observeCalls[1].options.attributes).toBe(true);
  } finally {
    uninstallMockMutationObserver(original);
  }
});

it('disconnects previous observer even when the next load throws on contentDocument access', () => {
  const original = installMockMutationObserver();
  try {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
    const docA = createFakeDoc(500);
    attachFakeDoc(iframe, docA);
    iframe.dispatchEvent(new Event('load'));
    expect(mockObservers.length).toBe(1);
    expect(mockObservers[0].disconnected).toBe(false);

    attachThrowingContentDocument(iframe);
    expect(() => iframe.dispatchEvent(new Event('load'))).not.toThrow();

    expect(mockObservers[0].disconnected).toBe(true);
  } finally {
    uninstallMockMutationObserver(original);
  }
});

// --- 機能単位 10: scrollHeight === 0 is written (no stale value) ---

it('writes "0px" / dataset="0" when scrollHeight is 0 (no stale value)', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
  iframe.style.height = '500px';
  iframe.dataset.htmlPreviewBaseHeight = '500';

  const doc = createFakeDoc(0);
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));

  expect(iframe.style.height).toBe('0px');
  expect(iframe.dataset.htmlPreviewBaseHeight).toBe('0');
});

// --- 機能単位 11: removeInlinePreview disconnects the observer ---

it('disconnects the iframe observer on removeInlinePreview', () => {
  const original = installMockMutationObserver();
  try {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const iframe = createInlinePreview(container, '<html><body>H</body></html>', 100);
    const doc = createFakeDoc(500);
    attachFakeDoc(iframe, doc);
    iframe.dispatchEvent(new Event('load'));
    expect(mockObservers.length).toBe(1);
    expect(mockObservers[0].disconnected).toBe(false);

    removeInlinePreview(container);

    expect(mockObservers[0].disconnected).toBe(true);
  } finally {
    uninstallMockMutationObserver(original);
  }
});
