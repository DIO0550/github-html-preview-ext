const MIN_ZOOM = 25;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

const ZOOM_DATASET_KEY = 'htmlPreviewZoom';
const ZOOM_LISTENER_DATASET_KEY = 'htmlPreviewZoomListener';

/**
 * Clamp a zoom value to the valid range (25-200%).
 * @param value - Raw zoom percentage
 * @returns Clamped zoom percentage
 */
function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * Apply the current persisted zoom scale from dataset to the iframe's body
 * via `contentDocument.body.style.zoom`. Guards against null contentDocument
 * (not yet loaded) and contentDocument getter throw (cross-origin).
 * @param iframe - The iframe whose body should receive the zoom
 */
function applyZoomToBody(iframe: HTMLIFrameElement): void {
  try {
    const doc = iframe.contentDocument;
    if (!doc?.body) return;
    const scale = iframe.dataset[ZOOM_DATASET_KEY];
    if (!scale) return;
    doc.body.style.zoom = scale;
  } catch {
    // cross-origin: contentDocument getter may throw
  }
}

/**
 * Register a persistent `load` listener that re-applies zoom on every load
 * (including `srcdoc` replacement). Guarded against duplicate registration
 * via a dataset flag.
 * @param iframe - The iframe to attach the persistent load listener to
 */
function ensureLoadListener(iframe: HTMLIFrameElement): void {
  if (iframe.dataset[ZOOM_LISTENER_DATASET_KEY] === '1') return;
  iframe.dataset[ZOOM_LISTENER_DATASET_KEY] = '1';
  iframe.addEventListener('load', () => {
    applyZoomToBody(iframe);
  });
}

/**
 * Apply a zoom level to an iframe by setting `contentDocument.body.style.zoom`.
 * The iframe's outer frame size is unchanged; only the content is scaled.
 * The scale is persisted on `iframe.dataset.htmlPreviewZoom` so it survives
 * `srcdoc` reload via a persistent load listener.
 * @param iframe - The iframe element to zoom
 * @param zoomPercent - Zoom percentage (e.g. 100 = no zoom). Clamped to 25-200.
 */
export function applyZoom(iframe: HTMLIFrameElement, zoomPercent: number): void {
  const clamped = clampZoom(zoomPercent);
  const scale = clamped / 100;
  iframe.dataset[ZOOM_DATASET_KEY] = String(scale);
  ensureLoadListener(iframe);
  // Clear legacy transform side effect from previous implementation
  iframe.style.transform = '';
  applyZoomToBody(iframe);
}

/**
 * Create a zoom control toolbar with +/- buttons and a numeric input.
 * @param iframe - The iframe element to control
 * @param defaultZoom - Initial zoom percentage (default 100)
 * @param onZoom - Optional override called whenever the user changes the
 *                 zoom level. When supplied, the legacy
 *                 `iframe.contentDocument.body.style.zoom` path is bypassed
 *                 — useful for cross-origin sandboxed iframes that need a
 *                 postMessage-based zoom path instead.
 * @returns A container element with zoom controls
 */
export function createZoomControl(
  iframe: HTMLIFrameElement,
  defaultZoom: number = 100,
  onZoom?: (zoomPercent: number) => void
): HTMLElement {
  let currentZoom = clampZoom(defaultZoom);

  const container = document.createElement('div');
  container.className = 'html-preview-zoom-control';
  container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'btn btn-sm';
  minusBtn.textContent = '−';
  minusBtn.type = 'button';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(MIN_ZOOM);
  input.max = String(MAX_ZOOM);
  input.step = String(ZOOM_STEP);
  input.value = String(currentZoom);
  input.style.cssText = 'width: 60px; text-align: center;';

  const plusBtn = document.createElement('button');
  plusBtn.className = 'btn btn-sm';
  plusBtn.textContent = '+';
  plusBtn.type = 'button';

  const percentLabel = document.createElement('span');
  percentLabel.textContent = '%';

  /**
   * Clamp the requested zoom, sync the input, and route through `onZoom`
   * when supplied or fall back to the legacy direct-DOM path.
   * @param value - Raw zoom percentage requested by the user
   */
  function updateZoom(value: number): void {
    currentZoom = clampZoom(value);
    input.value = String(currentZoom);
    if (onZoom) {
      onZoom(currentZoom);
      return;
    }
    applyZoom(iframe, currentZoom);
  }

  minusBtn.addEventListener('click', () => updateZoom(currentZoom - ZOOM_STEP));
  plusBtn.addEventListener('click', () => updateZoom(currentZoom + ZOOM_STEP));
  input.addEventListener('change', () => {
    const raw = input.value.trim();
    const parsed = Number(raw);
    // A cleared input parses to 0 (Number('') === 0) and would slam the zoom
    // to the 25% minimum; invalid text parses to NaN. Keep the current zoom
    // in both cases instead.
    updateZoom(raw === '' || !Number.isFinite(parsed) ? currentZoom : parsed);
  });

  container.appendChild(minusBtn);
  container.appendChild(input);
  container.appendChild(percentLabel);
  container.appendChild(plusBtn);

  // Apply the initial zoom through the same path as user interactions so
  // the bridge-based callback is exercised on first render.
  if (onZoom) {
    onZoom(currentZoom);
  } else {
    applyZoom(iframe, currentZoom);
  }

  return container;
}
