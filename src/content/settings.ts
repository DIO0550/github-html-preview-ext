import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings-types';
export type { ExtensionSettings } from '../shared/settings-types';
export { DEFAULT_SETTINGS } from '../shared/settings-types';

type ExtSettings = import('../shared/settings-types').ExtensionSettings;

let cachedSettings: ExtSettings = { ...DEFAULT_SETTINGS };

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
