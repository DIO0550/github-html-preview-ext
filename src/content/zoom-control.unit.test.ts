import { it, expect, beforeEach, test } from 'vitest';
import { applyZoom, createZoomControl } from './zoom-control';

// Test standard patterns (see implementation-plan.md §5.2)
// - Pattern A: fake contentDocument injection
// - Pattern C: throwing contentDocument getter (cross-origin simulation)

/**
 * Create a minimal fake Document with a real body and a fake documentElement.
 * @param scrollHeight - Value returned by documentElement.scrollHeight
 * @returns A fake Document object
 */
function createFakeDoc(scrollHeight: number = 500): Document {
  const body = document.createElement('body');
  const documentElement = {
    get scrollHeight(): number {
      return scrollHeight;
    },
  };
  return { body, documentElement } as unknown as Document;
}

/**
 * Attach a fake contentDocument getter to an iframe.
 * @param iframe - Target iframe
 * @param doc - Fake document to expose via contentDocument
 */
function attachFakeDoc(iframe: HTMLIFrameElement, doc: Document): void {
  Object.defineProperty(iframe, 'contentDocument', {
    configurable: true,
    get: () => doc,
  });
}

/**
 * Attach a contentDocument getter that returns null (simulates not-yet-loaded).
 * @param iframe - Target iframe
 */
function attachNullContentDocument(iframe: HTMLIFrameElement): void {
  Object.defineProperty(iframe, 'contentDocument', {
    configurable: true,
    get: () => null,
  });
}

/**
 * Attach a contentDocument getter that throws (simulates cross-origin access).
 * @param iframe - Target iframe
 */
function attachThrowingContentDocument(iframe: HTMLIFrameElement): void {
  Object.defineProperty(iframe, 'contentDocument', {
    configurable: true,
    get: () => {
      throw new Error('cross-origin');
    },
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// applyZoom — normal cases

it('sets body.style.zoom to "1" for 100%', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  applyZoom(iframe, 100);
  expect(doc.body.style.zoom).toBe('1');
});

it('sets body.style.zoom to "0.5" for 50%', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  applyZoom(iframe, 50);
  expect(doc.body.style.zoom).toBe('0.5');
});

it('sets body.style.zoom to "1.5" for 150%', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  applyZoom(iframe, 150);
  expect(doc.body.style.zoom).toBe('1.5');
});

test.each([
  [25, '0.25'],
  [50, '0.5'],
  [75, '0.75'],
  [100, '1'],
  [125, '1.25'],
  [150, '1.5'],
  [175, '1.75'],
  [200, '2'],
])('applyZoom(%i) sets body.style.zoom to "%s"', (input, expected) => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  applyZoom(iframe, input);
  expect(doc.body.style.zoom).toBe(expected);
});

test.each([
  [0, '0.25'],
  [10, '0.25'],
  [-50, '0.25'],
])('clamps lower bound: applyZoom(%i) → "%s"', (input, expected) => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  applyZoom(iframe, input);
  expect(doc.body.style.zoom).toBe(expected);
});

test.each([
  [201, '2'],
  [250, '2'],
  [300, '2'],
])('clamps upper bound: applyZoom(%i) → "%s"', (input, expected) => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  applyZoom(iframe, input);
  expect(doc.body.style.zoom).toBe(expected);
});

// Dataset persistence

it('persists the scale on iframe.dataset.htmlPreviewZoom', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  applyZoom(iframe, 150);
  expect(iframe.dataset.htmlPreviewZoom).toBe('1.5');
});

// Not-loaded guard (null contentDocument)

it('does not throw when contentDocument is null and still updates dataset', () => {
  const iframe = document.createElement('iframe');
  attachNullContentDocument(iframe);
  expect(() => applyZoom(iframe, 150)).not.toThrow();
  expect(iframe.dataset.htmlPreviewZoom).toBe('1.5');
});

// Cross-origin guard (throwing contentDocument getter)

it('does not throw when contentDocument getter throws, dataset still updates', () => {
  const iframe = document.createElement('iframe');
  attachThrowingContentDocument(iframe);
  expect(() => applyZoom(iframe, 150)).not.toThrow();
  expect(iframe.dataset.htmlPreviewZoom).toBe('1.5');
});

it('re-applies zoom on load after cross-origin getter is swapped to a fake doc', () => {
  const iframe = document.createElement('iframe');
  attachThrowingContentDocument(iframe);
  applyZoom(iframe, 150);
  // Swap to a real fake doc and fire load — the persistent load listener should reapply.
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));
  expect(doc.body.style.zoom).toBe('1.5');
});

// Persistent load listener re-application

it('re-applies zoom on load even when initial contentDocument was null', () => {
  const iframe = document.createElement('iframe');
  attachNullContentDocument(iframe);
  applyZoom(iframe, 175);
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  iframe.dispatchEvent(new Event('load'));
  expect(doc.body.style.zoom).toBe('1.75');
});

it('re-applies zoom on srcdoc-triggered load re-fire (new fake doc)', () => {
  const iframe = document.createElement('iframe');
  const docA = createFakeDoc();
  attachFakeDoc(iframe, docA);
  applyZoom(iframe, 150);
  expect(docA.body.style.zoom).toBe('1.5');
  const docB = createFakeDoc();
  attachFakeDoc(iframe, docB);
  iframe.dispatchEvent(new Event('load'));
  expect(docB.body.style.zoom).toBe('1.5');
});

// transform side-effect clear

it('clears legacy transform style to empty string', () => {
  const iframe = document.createElement('iframe');
  iframe.style.transform = 'scale(1.5)';
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  applyZoom(iframe, 100);
  expect(iframe.style.transform).toBe('');
});

// createZoomControl

it('initializes with default zoom value in input', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  const control = createZoomControl(iframe, 100);
  const input = control.querySelector('input') as HTMLInputElement;
  expect(input.value).toBe('100');
});

it('increments zoom by 10 on + button click → body.zoom "1.1"', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  const control = createZoomControl(iframe, 100);
  const buttons = control.querySelectorAll('button');
  const plusBtn = Array.from(buttons).find((b) => b.textContent === '+')!;
  const input = control.querySelector('input') as HTMLInputElement;

  plusBtn.click();

  expect(input.value).toBe('110');
  expect(doc.body.style.zoom).toBe('1.1');
  expect(iframe.dataset.htmlPreviewZoom).toBe('1.1');
});

it('decrements zoom by 10 on - button click → body.zoom "0.9"', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  const control = createZoomControl(iframe, 100);
  const buttons = control.querySelectorAll('button');
  const minusBtn = Array.from(buttons).find((b) => b.textContent === '−')!;
  const input = control.querySelector('input') as HTMLInputElement;

  minusBtn.click();

  expect(input.value).toBe('90');
  expect(doc.body.style.zoom).toBe('0.9');
  expect(iframe.dataset.htmlPreviewZoom).toBe('0.9');
});

it('does not exceed 200% on + click', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  const control = createZoomControl(iframe, 200);
  const buttons = control.querySelectorAll('button');
  const plusBtn = Array.from(buttons).find((b) => b.textContent === '+')!;
  const input = control.querySelector('input') as HTMLInputElement;

  plusBtn.click();

  expect(input.value).toBe('200');
});

it('does not go below 25% on - click', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  const control = createZoomControl(iframe, 25);
  const buttons = control.querySelectorAll('button');
  const minusBtn = Array.from(buttons).find((b) => b.textContent === '−')!;
  const input = control.querySelector('input') as HTMLInputElement;

  minusBtn.click();

  expect(input.value).toBe('25');
});

it('allows direct value input', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  const control = createZoomControl(iframe, 100);
  const input = control.querySelector('input') as HTMLInputElement;

  input.value = '75';
  input.dispatchEvent(new Event('change'));

  expect(doc.body.style.zoom).toBe('0.75');
});

it('clamps direct input to valid range', () => {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc();
  attachFakeDoc(iframe, doc);
  const control = createZoomControl(iframe, 100);
  const input = control.querySelector('input') as HTMLInputElement;

  input.value = '999';
  input.dispatchEvent(new Event('change'));

  expect(input.value).toBe('200');
  expect(doc.body.style.zoom).toBe('2');
});
