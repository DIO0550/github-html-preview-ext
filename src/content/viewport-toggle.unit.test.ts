import { it, expect, beforeEach } from 'vitest';
import { createViewportToggle, setViewport } from './viewport-toggle';

beforeEach(() => {
  document.body.innerHTML = '';
});

it('creates a button group with 3 viewport options', () => {
  const iframe = document.createElement('iframe');
  const toggle = createViewportToggle(iframe);

  const buttons = toggle.querySelectorAll('button');
  expect(buttons).toHaveLength(3);
  expect(buttons[0].textContent).toBe('Mobile');
  expect(buttons[1].textContent).toBe('Tablet');
  expect(buttons[2].textContent).toBe('Desktop');
});

it('sets iframe width to 375px for mobile viewport', () => {
  const iframe = document.createElement('iframe');
  setViewport(iframe, 'mobile');
  expect(iframe.style.width).toBe('375px');
});

it('sets iframe width to 768px for tablet viewport', () => {
  const iframe = document.createElement('iframe');
  setViewport(iframe, 'tablet');
  expect(iframe.style.width).toBe('768px');
});

it('sets iframe width to 100% for desktop viewport', () => {
  const iframe = document.createElement('iframe');
  setViewport(iframe, 'desktop');
  expect(iframe.style.width).toBe('100%');
});

it('clicking a viewport button sets the active class', () => {
  const iframe = document.createElement('iframe');
  const toggle = createViewportToggle(iframe);
  const buttons = toggle.querySelectorAll('button');

  (buttons[0] as HTMLButtonElement).click();
  expect(buttons[0].classList.contains('selected')).toBe(true);
  expect(buttons[2].classList.contains('selected')).toBe(false);
});

it('clicking a viewport button changes iframe width', () => {
  const iframe = document.createElement('iframe');
  const toggle = createViewportToggle(iframe);
  const buttons = toggle.querySelectorAll('button');

  (buttons[0] as HTMLButtonElement).click();
  expect(iframe.style.width).toBe('375px');

  (buttons[2] as HTMLButtonElement).click();
  expect(iframe.style.width).toBe('100%');
});
