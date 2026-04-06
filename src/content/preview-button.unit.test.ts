import { it, expect, vi, beforeEach } from 'vitest';
import {
  createPreviewButton,
  insertPreviewButton,
  addPreviewButtonToHeader,
} from './preview-button';

beforeEach(() => {
  document.body.innerHTML = '';
});

// createPreviewButton

it('creates a button element with correct class and text', () => {
  const btn = createPreviewButton('Preview', vi.fn());
  expect(btn.tagName).toBe('BUTTON');
  expect(btn.classList.contains('html-preview-btn')).toBe(true);
  expect(btn.classList.contains('btn')).toBe(true);
  expect(btn.classList.contains('btn-sm')).toBe(true);
  expect(btn.textContent).toBe('Preview');
});

it('creates a button with custom label', () => {
  const btn = createPreviewButton('Inline', vi.fn());
  expect(btn.textContent).toBe('Inline');
});

it('calls handler when clicked', () => {
  const handler = vi.fn();
  const btn = createPreviewButton('Preview', handler);
  btn.click();
  expect(handler).toHaveBeenCalledOnce();
});

// insertPreviewButton

it('inserts button into .file-actions container', () => {
  const header = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  header.appendChild(actions);

  const btn = document.createElement('button');
  insertPreviewButton(header, btn);

  expect(actions.contains(btn)).toBe(true);
});

it('falls back to .file-info container', () => {
  const header = document.createElement('div');
  const info = document.createElement('div');
  info.className = 'file-info';
  header.appendChild(info);

  const btn = document.createElement('button');
  insertPreviewButton(header, btn);

  expect(info.contains(btn)).toBe(true);
});

it('falls back to appending to header itself', () => {
  const header = document.createElement('div');

  const btn = document.createElement('button');
  insertPreviewButton(header, btn);

  expect(header.contains(btn)).toBe(true);
});

// addPreviewButtonToHeader — 3 buttons

it('does not insert duplicate buttons', () => {
  const header = document.createElement('div');
  const existing = document.createElement('button');
  existing.className = 'html-preview-btn';
  header.appendChild(existing);

  addPreviewButtonToHeader(header, 'https://example.com/raw/file.html');

  const buttons = header.querySelectorAll('.html-preview-btn');
  expect(buttons).toHaveLength(1);
});

it('inserts 3 preview buttons (Preview, Inline, Panel)', () => {
  const header = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  header.appendChild(actions);

  addPreviewButtonToHeader(header, 'https://example.com/raw/file.html');

  const buttons = header.querySelectorAll('.html-preview-btn');
  expect(buttons).toHaveLength(3);
  expect(buttons[0].textContent).toBe('Preview');
  expect(buttons[1].textContent).toBe('Inline');
  expect(buttons[2].textContent).toBe('Panel');
});

it('Preview button calls fetchAndPreview handler', () => {
  const header = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'file-actions';
  header.appendChild(actions);

  addPreviewButtonToHeader(header, 'https://example.com/raw/file.html');

  const previewBtn = header.querySelectorAll('.html-preview-btn')[0] as HTMLButtonElement;
  expect(previewBtn.textContent).toBe('Preview');
});
