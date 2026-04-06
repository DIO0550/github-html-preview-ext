import { it, expect, vi, beforeEach } from 'vitest';
import { updateButtonState } from './preview-button';

beforeEach(() => {
  vi.useFakeTimers();
});

it('sets button to loading state', () => {
  const btn = document.createElement('button');
  btn.textContent = 'Preview';

  updateButtonState(btn, 'loading');

  expect(btn.textContent).toBe('Loading...');
  expect(btn.disabled).toBe(true);
});

it('sets button to error state with message', () => {
  const btn = document.createElement('button');
  btn.textContent = 'Preview';

  updateButtonState(btn, 'error', 'Network error');

  expect(btn.textContent).toBe('Network error');
});

it('reverts button to idle after 3 seconds on error', () => {
  const btn = document.createElement('button');
  btn.textContent = 'Preview';

  updateButtonState(btn, 'error', 'Preview failed');

  vi.advanceTimersByTime(3000);

  expect(btn.textContent).toBe('Preview');
  expect(btn.disabled).toBe(false);
});

it('sets button back to idle state', () => {
  const btn = document.createElement('button');
  btn.textContent = 'Loading...';
  btn.disabled = true;

  updateButtonState(btn, 'idle');

  expect(btn.textContent).toBe('Preview');
  expect(btn.disabled).toBe(false);
});
