import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startObserving, stopObserving } from './observer';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stopObserving();
  vi.useRealTimers();
});

it('calls callback immediately on start (initial scan)', () => {
  const callback = vi.fn();
  startObserving(callback);
  expect(callback).toHaveBeenCalledOnce();
});

it('calls callback on turbo:load event', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  document.dispatchEvent(new Event('turbo:load'));
  expect(callback).toHaveBeenCalledOnce();
});

it('calls callback on popstate event', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  window.dispatchEvent(new Event('popstate'));
  expect(callback).toHaveBeenCalledOnce();
});

it('stops observing when stopObserving is called', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  stopObserving();
  document.dispatchEvent(new Event('turbo:load'));
  expect(callback).not.toHaveBeenCalled();
});

// debounce tests

it('debounces rapid DOM changes to a single callback', async () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  // Trigger multiple rapid DOM changes
  document.body.appendChild(document.createElement('div'));
  document.body.appendChild(document.createElement('span'));
  document.body.appendChild(document.createElement('p'));

  // Wait for MutationObserver microtask
  await vi.advanceTimersByTimeAsync(0);

  // Should not have fired yet (within debounce window)
  expect(callback).not.toHaveBeenCalled();

  // Advance past debounce delay
  await vi.advanceTimersByTimeAsync(150);
  expect(callback).toHaveBeenCalledOnce();
});

it('fires again after debounce period for new changes', async () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  document.body.appendChild(document.createElement('div'));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(150);
  expect(callback).toHaveBeenCalledOnce();

  callback.mockClear();
  document.body.appendChild(document.createElement('span'));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(150);
  expect(callback).toHaveBeenCalledOnce();
});
