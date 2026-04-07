const MIN_ZOOM = 25;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

/**
 * Clamp a zoom value to the valid range (25-200%).
 * @param value - Raw zoom percentage
 * @returns Clamped zoom percentage
 */
function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * Apply a zoom level to an iframe using CSS transform.
 * Values outside 25-200% are clamped.
 * @param iframe - The iframe element to zoom
 * @param zoomPercent - Zoom percentage (e.g. 100 = no zoom)
 */
export function applyZoom(iframe: HTMLIFrameElement, zoomPercent: number): void {
  const clamped = clampZoom(zoomPercent);
  const scale = clamped / 100;
  iframe.style.transform = `scale(${scale})`;
  iframe.style.transformOrigin = 'top left';
}

/**
 * Create a zoom control toolbar with +/- buttons and a numeric input.
 * @param iframe - The iframe element to control
 * @param defaultZoom - Initial zoom percentage (default 100)
 * @returns A container element with zoom controls
 */
export function createZoomControl(iframe: HTMLIFrameElement, defaultZoom: number = 100): HTMLElement {
  let currentZoom = clampZoom(defaultZoom);

  const container = document.createElement('div');
  container.className = 'html-preview-zoom-control';
  container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'btn btn-sm';
  minusBtn.textContent = '−';

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

  const percentLabel = document.createElement('span');
  percentLabel.textContent = '%';

  const updateZoom = (value: number) => {
    currentZoom = clampZoom(value);
    input.value = String(currentZoom);
    applyZoom(iframe, currentZoom);
  };

  minusBtn.addEventListener('click', () => updateZoom(currentZoom - ZOOM_STEP));
  plusBtn.addEventListener('click', () => updateZoom(currentZoom + ZOOM_STEP));
  input.addEventListener('change', () => updateZoom(Number(input.value)));

  container.appendChild(minusBtn);
  container.appendChild(input);
  container.appendChild(percentLabel);
  container.appendChild(plusBtn);

  applyZoom(iframe, currentZoom);

  return container;
}
