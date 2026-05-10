import { it, expect, beforeEach, vi } from 'vitest';

vi.mock('./auto-update-cache', () => ({
  resetLastPanelRawUrl: vi.fn(),
}));

import {
  createSidePanel,
  showInPanel,
  closeSidePanel,
  isSidePanelOpen,
  updateSidePanelContent,
} from './side-panel';
import { resetLastPanelRawUrl } from './auto-update-cache';

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.marginRight = '';
  vi.mocked(chrome.runtime.getURL).mockImplementation(
    (path: string) => `chrome-extension://mock-id/${path}`
  );
  vi.mocked(resetLastPanelRawUrl).mockClear();
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

it('marks the header element with data-testid="html-preview-panel-header"', () => {
  createSidePanel();
  const header = document.querySelector('[data-testid="html-preview-panel-header"]');
  expect(header).not.toBeNull();
  closeSidePanel();
});

it('invokes the onReady callback once after the panel is mounted', () => {
  const onReady = vi.fn();
  createSidePanel(onReady);
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(document.getElementById('html-preview-panel')).not.toBeNull();
  closeSidePanel();
});

// isSidePanelOpen

it('isSidePanelOpen returns false before the panel is created', () => {
  expect(isSidePanelOpen()).toBe(false);
});

it('isSidePanelOpen returns true once the panel is mounted', () => {
  createSidePanel();
  expect(isSidePanelOpen()).toBe(true);
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

// updateSidePanelContent

it('updates the header file name when the panel is open', () => {
  createSidePanel();
  updateSidePanelContent('<html><body>X</body></html>', 'page.html');

  const header = document.querySelector('[data-testid="html-preview-panel-header"]');
  expect(header?.textContent).toContain('page.html');
  closeSidePanel();
});

it('updateSidePanelContent overwrites the previous file name on re-render', () => {
  createSidePanel();
  updateSidePanelContent('<p>a</p>', 'a.html');
  updateSidePanelContent('<p>b</p>', 'b.html');

  const header = document.querySelector('[data-testid="html-preview-panel-header"]');
  expect(header?.textContent).toContain('b.html');
  expect(header?.textContent).not.toContain('a.html');
  closeSidePanel();
});

it('updateSidePanelContent is a no-op when the panel is not open', () => {
  expect(() => updateSidePanelContent('<p>x</p>', 'x.html')).not.toThrow();
  expect(document.getElementById('html-preview-panel')).toBeNull();
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

it('closeSidePanel resets the panel rawUrl tracker', () => {
  createSidePanel();
  closeSidePanel();
  expect(resetLastPanelRawUrl).toHaveBeenCalled();
});
