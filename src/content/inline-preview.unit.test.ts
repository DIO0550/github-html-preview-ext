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

// zoom integration

it('creates zoom control in the toolbar when defaultZoom is provided', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  createInlinePreview(container, '<html><body>Zoom</body></html>', 150);

  const zoomControl = container.querySelector('.html-preview-zoom-control');
  expect(zoomControl).not.toBeNull();
});

it('applies default zoom to iframe when defaultZoom is provided', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>Zoom</body></html>', 150);

  expect(iframe.style.transform).toBe('scale(1.5)');
});

it('defaults to 100% zoom when no defaultZoom provided', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const iframe = createInlinePreview(container, '<html><body>No zoom</body></html>');

  expect(iframe.style.transform).toBe('scale(1)');
});
