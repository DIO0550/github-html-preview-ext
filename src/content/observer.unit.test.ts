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

// pushState / replaceState hook tests

it('calls callback when history.pushState is invoked', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  history.pushState({}, '', '/new-path');
  expect(callback).toHaveBeenCalledOnce();
});

it('calls callback when history.replaceState is invoked', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  history.replaceState({}, '', '/replaced-path');
  expect(callback).toHaveBeenCalledOnce();
});

it('passes original arguments through to history.pushState', () => {
  const callback = vi.fn();
  startObserving(callback);

  const state = { foo: 'bar' };
  history.pushState(state, '', '/passthrough');
  expect(location.pathname).toBe('/passthrough');
  expect(history.state).toEqual(state);
});

it('restores original history.pushState/replaceState on stopObserving', () => {
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const callback = vi.fn();

  startObserving(callback);
  expect(history.pushState).not.toBe(originalPush);
  expect(history.replaceState).not.toBe(originalReplace);

  stopObserving();
  expect(history.pushState).toBe(originalPush);
  expect(history.replaceState).toBe(originalReplace);
});

it('does not invoke callback after stopObserving when pushState is called', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();
  stopObserving();

  history.pushState({}, '', '/after-stop');
  expect(callback).not.toHaveBeenCalled();
});

// hashchange tests

it('calls callback on hashchange event', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();

  window.dispatchEvent(new Event('hashchange'));
  expect(callback).toHaveBeenCalledOnce();
});

it('does not invoke callback after stopObserving when hashchange fires', () => {
  const callback = vi.fn();
  startObserving(callback);
  callback.mockClear();
  stopObserving();

  window.dispatchEvent(new Event('hashchange'));
  expect(callback).not.toHaveBeenCalled();
});
