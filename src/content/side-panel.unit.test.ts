import { it, expect, beforeEach, vi } from 'vitest';
import { createSidePanel, showInPanel, closeSidePanel } from './side-panel';

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.marginRight = '';
  vi.mocked(chrome.runtime.getURL).mockImplementation(
    (path: string) => `chrome-extension://mock-id/${path}`
  );
});

// createSidePanel

it('adds a fixed panel to document.body', () => {
  createSidePanel();
  const panel = document.getElementById('html-preview-panel');
  expect(panel).not.toBeNull();
  expect(panel?.style.position).toBe('fixed');
  closeSidePanel();
});

it('sets document.body.style.marginRight to adjust layout', () => {
  createSidePanel();
  expect(document.body.style.marginRight).toBe('40%');
  closeSidePanel();
});

it('points panel iframe src at preview-frame.html', () => {
  createSidePanel();
  const iframe = document.querySelector('#html-preview-panel iframe') as HTMLIFrameElement;
  expect(iframe.src).toBe('chrome-extension://mock-id/src/preview-frame.html');
  closeSidePanel();
});

// showInPanel

it('creates panel if it does not exist', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  expect(document.getElementById('html-preview-panel')).not.toBeNull();
  closeSidePanel();
});

it('does not use a blob URL for the iframe', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const iframe = document.querySelector('#html-preview-panel iframe') as HTMLIFrameElement;
  expect(iframe.src).not.toMatch(/^blob:/);
  closeSidePanel();
});

it('displays file name in header', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const panel = document.getElementById('html-preview-panel')!;
  expect(panel.textContent).toContain('index.html');
  closeSidePanel();
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

it('close button triggers panel removal', () => {
  showInPanel('<html><body>Hello</body></html>', 'index.html');
  const closeBtn = document.getElementById('html-preview-panel-close');
  expect(closeBtn).not.toBeNull();
  closeBtn?.click();
  expect(document.getElementById('html-preview-panel')).toBeNull();
});
