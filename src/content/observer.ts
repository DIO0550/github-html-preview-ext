const DEBOUNCE_DELAY_MS = 150;

let observer: MutationObserver | null = null;
let turboHandler: (() => void) | null = null;
let popstateHandler: (() => void) | null = null;

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
 * Start observing DOM changes and navigation events.
 * Calls the callback immediately for an initial scan, then on every
 * MutationObserver trigger (debounced 150ms), `turbo:load`, and `popstate` event.
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
}
