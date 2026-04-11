import { it, expect, beforeEach } from 'vitest';
import { createSidePanel, showInPanel, closeSidePanel } from './side-panel';
import { applyZoom } from './zoom-control';

/**
 * Create a fake Document with a real body for zoom assertions.
 * @returns A fake document
 */
function createFakeDoc(): Document {
  const body = document.createElement('body');
  const documentElement = { get scrollHeight(): number { return 500; } };
  return { body, documentElement } as unknown as Document;
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

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.marginRight = '';
});

// createSidePanel

it('adds a fixed panel to document.body', () => {
  createSidePanel();
  const panel = document.getElementById('html-preview-panel');
  expect(panel).not.toBeNull();
  expect(panel?.style.position).toBe('fixed');
});

it('sets document.body.style.marginRight to adjust layout', () => {
  createSidePanel();
  expect(document.body.style.marginRight).toBe('40%');
});

it('contains an iframe with sandbox allow-scripts', () => {
  createSidePanel();
  const iframe = document.querySelector('#html-preview-panel iframe');
  expect(iframe).not.toBeNull();
  expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
});

// showInPanel

it('creates panel if it does not exist', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  expect(document.getElementById('html-preview-panel')).not.toBeNull();
});

it('sets iframe srcdoc to provided HTML', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const iframe = document.querySelector('#html-preview-panel iframe') as HTMLIFrameElement;
  expect(iframe.srcdoc).toContain('Hello');
});

it('displays file name in header', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const panel = document.getElementById('html-preview-panel')!;
  expect(panel.textContent).toContain('index.html');
});

// closeSidePanel

it('removes the panel from DOM', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  closeSidePanel();
  expect(document.getElementById('html-preview-panel')).toBeNull();
});

it('restores document.body.style.marginRight', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  closeSidePanel();
  expect(document.body.style.marginRight).toBe('');
});

it('contains zoom control in toolbar', () => {
  createSidePanel();
  const zoomControl = document.querySelector('.html-preview-zoom-control');
  expect(zoomControl).not.toBeNull();
});

it('close button triggers panel removal', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const closeBtn = document.getElementById('html-preview-panel-close');
  expect(closeBtn).not.toBeNull();
  closeBtn?.click();
  expect(document.getElementById('html-preview-panel')).toBeNull();
});

// zoom retention regression (review 指摘 #2)

it('retains body.style.zoom after showInPanel is called a second time (srcdoc swap)', () => {
  showInPanel('<html><body>A</body></html>', 'a.html');
  const iframe = document.querySelector('#html-preview-panel iframe') as HTMLIFrameElement;

  // First load: attach fake doc A and fire load; then set zoom to 150%.
  const docA = createFakeDoc();
  attachFakeDoc(iframe, docA);
  iframe.dispatchEvent(new Event('load'));
  applyZoom(iframe, 150);
  expect(docA.body.style.zoom).toBe('1.5');

  // Second showInPanel swaps srcdoc → load re-fires on a new document.
  showInPanel('<html><body>B</body></html>', 'b.html');
  const docB = createFakeDoc();
  attachFakeDoc(iframe, docB);
  iframe.dispatchEvent(new Event('load'));

  expect(docB.body.style.zoom).toBe('1.5');
  expect(iframe.dataset.htmlPreviewZoom).toBe('1.5');
});

it('retains dataset.htmlPreviewZoom across srcdoc swaps', () => {
  showInPanel('<html><body>A</body></html>', 'a.html');
  const iframe = document.querySelector('#html-preview-panel iframe') as HTMLIFrameElement;
  const docA = createFakeDoc();
  attachFakeDoc(iframe, docA);
  iframe.dispatchEvent(new Event('load'));
  applyZoom(iframe, 75);
  expect(iframe.dataset.htmlPreviewZoom).toBe('0.75');

  showInPanel('<html><body>B</body></html>', 'b.html');
  const docB = createFakeDoc();
  attachFakeDoc(iframe, docB);
  iframe.dispatchEvent(new Event('load'));

  expect(iframe.dataset.htmlPreviewZoom).toBe('0.75');
  expect(docB.body.style.zoom).toBe('0.75');
});
