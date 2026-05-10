const DEBOUNCE_DELAY_MS = 150;

let observer: MutationObserver | null = null;
let turboHandler: (() => void) | null = null;
let popstateHandler: (() => void) | null = null;
let hashchangeHandler: (() => void) | null = null;
let originalPushState: typeof history.pushState | null = null;
let originalReplaceState: typeof history.replaceState | null = null;

/**
 * Create a debounced version of a function.
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
function debounce(fn: () => void, delay: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

/**
 * Wrap history.pushState / history.replaceState so that the callback is
 * invoked after each call. GitHub uses pushState for SPA navigation (clicking
 * between files in the Code tab) — popstate does not fire for these.
 * @param callback - Function to invoke after each pushState/replaceState call
 */
function hookHistoryApi(callback: () => void): void {
  originalPushState = history.pushState;
  originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    const result = originalPushState!.apply(this, args);
    callback();
    return result;
  };
  history.replaceState = function (...args) {
    const result = originalReplaceState!.apply(this, args);
    callback();
    return result;
  };
}

/**
 * Restore the original history.pushState / history.replaceState functions.
 */
function unhookHistoryApi(): void {
  if (originalPushState) {
    history.pushState = originalPushState;
    originalPushState = null;
  }
  if (originalReplaceState) {
    history.replaceState = originalReplaceState;
    originalReplaceState = null;
  }
}

/**
 * Start observing DOM changes and navigation events.
 * Calls the callback immediately for an initial scan, then on every
 * MutationObserver trigger (debounced 150ms), `turbo:load`, `popstate`,
 * `pushState`, and `replaceState` event.
 * @param callback - Function to call when the page content may have changed
 */
export function startObserving(callback: () => void): void {
  // Initial scan
  callback();

  // MutationObserver with debounce for lazy-loaded diffs
  const debouncedCallback = debounce(callback, DEBOUNCE_DELAY_MS);
  observer = new MutationObserver(() => {
    debouncedCallback();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // PJAX/Turbo navigation (not debounced — these are discrete events)
  turboHandler = () => callback();
  document.addEventListener('turbo:load', turboHandler);

  popstateHandler = () => callback();
  window.addEventListener('popstate', popstateHandler);

  // `hashchange` only matters for direct `location.hash =` assignments —
  // pushState-driven hash changes are already covered by the history hook.
  hashchangeHandler = () => callback();
  window.addEventListener('hashchange', hashchangeHandler);

  // GitHub SPA navigation uses pushState; popstate does not fire for it.
  hookHistoryApi(callback);
}

/**
 * Stop observing DOM changes and remove all event listeners.
 */
export function stopObserving(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (turboHandler) {
    document.removeEventListener('turbo:load', turboHandler);
    turboHandler = null;
  }
  if (popstateHandler) {
    window.removeEventListener('popstate', popstateHandler);
    popstateHandler = null;
  }
  if (hashchangeHandler) {
    window.removeEventListener('hashchange', hashchangeHandler);
    hashchangeHandler = null;
  }
  unhookHistoryApi();
}
