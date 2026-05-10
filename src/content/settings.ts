import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings-types';
export type { ExtensionSettings } from '../shared/settings-types';
export { DEFAULT_SETTINGS } from '../shared/settings-types';

type ExtSettings = import('../shared/settings-types').ExtensionSettings;

type SettingsChangeCallback = (next: ExtSettings) => void;

let cachedSettings: ExtSettings = { ...DEFAULT_SETTINGS };

const WATCHED_KEYS: ReadonlyArray<keyof ExtSettings> =
  Object.keys(DEFAULT_SETTINGS) as (keyof ExtSettings)[];

/**
 * Load extension settings from chrome.storage.sync.
 * Falls back to default values on error or missing keys.
 * Caches the result for synchronous access via getCachedSettings().
 * @returns Resolved settings merged with defaults
 */
export async function loadSettings(): Promise<ExtSettings> {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    cachedSettings = normalizeSettings(stored);
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings;
}

/**
 * Get the most recently loaded settings (synchronous).
 * Returns default values if loadSettings() has not yet been called.
 * @returns Cached extension settings
 */
export function getCachedSettings(): ExtSettings {
  return cachedSettings;
}

/**
 * Subscribe to `chrome.storage.sync` changes that affect any of the keys
 * the extension reads. The popup writes settings as four separate keys
 * (`allowedRepos`, `autoPreview`, `defaultZoom`, `enableJavaScript`), so
 * the listener filters on `area === 'sync'` and the presence of any
 * watched key, then re-runs `loadSettings()` to refresh the cache before
 * forwarding the normalised value to `onChange`.
 * @param onChange - Callback invoked with the freshly-normalised settings
 * @returns Unsubscribe function
 */
export function subscribeSettingsChanges(onChange: SettingsChangeCallback): () => void {
  /**
   * Storage change listener that filters non-sync areas and unrelated keys.
   * @param changes - Per-key change objects from chrome.storage.onChanged
   * @param area - Storage area name (we only care about 'sync')
   */
  function listener(
    changes: { [k: string]: chrome.storage.StorageChange },
    area: string
  ): void {
    if (area !== 'sync') return;
    if (!WATCHED_KEYS.some((k) => k in changes)) return;
    void loadSettings().then(onChange);
  }
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
