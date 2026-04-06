import { it, expect, beforeEach } from 'vitest';
import {
  createInlinePreview,
  toggleInlinePreview,
  removeInlinePreview,
} from './inline-preview';

beforeEach(() => {
  document.body.innerHTML = '';
});

// createInlinePreview

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

  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
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

// removeInlinePreview

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
