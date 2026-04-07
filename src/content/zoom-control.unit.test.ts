import { it, expect, beforeEach, test } from 'vitest';
import { applyZoom, createZoomControl } from './zoom-control';

beforeEach(() => {
  document.body.innerHTML = '';
});

// applyZoom

it('sets transform scale(1) for 100%', () => {
  const iframe = document.createElement('iframe');
  applyZoom(iframe, 100);
  expect(iframe.style.transform).toBe('scale(1)');
});

it('sets transform scale(1.5) for 150%', () => {
  const iframe = document.createElement('iframe');
  applyZoom(iframe, 150);
  expect(iframe.style.transform).toBe('scale(1.5)');
});

it('sets transform-origin to top left', () => {
  const iframe = document.createElement('iframe');
  applyZoom(iframe, 100);
  expect(iframe.style.transformOrigin).toBe('top left');
});


test.each([
  [250, 200],
  [10, 25],
  [0, 25],
  [300, 200],
])('clamps zoom %i to %i', (input, expected) => {
  const iframe = document.createElement('iframe');
  applyZoom(iframe, input);
  const scale = expected / 100;
  expect(iframe.style.transform).toBe(`scale(${scale})`);
});

// createZoomControl

it('initializes with default zoom value in input', () => {
  const iframe = document.createElement('iframe');
  const control = createZoomControl(iframe, 100);
  const input = control.querySelector('input') as HTMLInputElement;
  expect(input.value).toBe('100');
});

it('increments zoom by 10 on + button click', () => {
  const iframe = document.createElement('iframe');
  const control = createZoomControl(iframe, 100);
  const buttons = control.querySelectorAll('button');
  const plusBtn = Array.from(buttons).find((b) => b.textContent === '+')!;
  const input = control.querySelector('input') as HTMLInputElement;

  plusBtn.click();

  expect(input.value).toBe('110');
  expect(iframe.style.transform).toBe('scale(1.1)');
});

it('decrements zoom by 10 on - button click', () => {
  const iframe = document.createElement('iframe');
  const control = createZoomControl(iframe, 100);
  const buttons = control.querySelectorAll('button');
  const minusBtn = Array.from(buttons).find((b) => b.textContent === '−')!;
  const input = control.querySelector('input') as HTMLInputElement;

  minusBtn.click();

  expect(input.value).toBe('90');
  expect(iframe.style.transform).toBe('scale(0.9)');
});

it('does not exceed 200% on + click', () => {
  const iframe = document.createElement('iframe');
  const control = createZoomControl(iframe, 200);
  const buttons = control.querySelectorAll('button');
  const plusBtn = Array.from(buttons).find((b) => b.textContent === '+')!;
  const input = control.querySelector('input') as HTMLInputElement;

  plusBtn.click();

  expect(input.value).toBe('200');
});

it('does not go below 25% on - click', () => {
  const iframe = document.createElement('iframe');
  const control = createZoomControl(iframe, 25);
  const buttons = control.querySelectorAll('button');
  const minusBtn = Array.from(buttons).find((b) => b.textContent === '−')!;
  const input = control.querySelector('input') as HTMLInputElement;

  minusBtn.click();

  expect(input.value).toBe('25');
});

it('allows direct value input', () => {
  const iframe = document.createElement('iframe');
  const control = createZoomControl(iframe, 100);
  const input = control.querySelector('input') as HTMLInputElement;

  input.value = '75';
  input.dispatchEvent(new Event('change'));

  expect(iframe.style.transform).toBe('scale(0.75)');
});

it('clamps direct input to valid range', () => {
  const iframe = document.createElement('iframe');
  const control = createZoomControl(iframe, 100);
  const input = control.querySelector('input') as HTMLInputElement;

  input.value = '999';
  input.dispatchEvent(new Event('change'));

  expect(input.value).toBe('200');
  expect(iframe.style.transform).toBe('scale(2)');
});
