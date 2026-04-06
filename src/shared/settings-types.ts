export type ExtensionSettings = {
  allowedRepos: string[];
  autoPreview: boolean;
  defaultZoom: number;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  allowedRepos: [],
  autoPreview: false,
  defaultZoom: 100,
};

/**
 * Normalize raw storage data into a valid ExtensionSettings object.
 * Handles corrupted or unexpected types gracefully.
 * @param raw - Raw data from chrome.storage.sync.get
 * @returns Validated and sanitized settings
 */
export function normalizeSettings(raw: Record<string, unknown>): ExtensionSettings {
  const allowedRepos = Array.isArray(raw.allowedRepos)
    ? raw.allowedRepos.filter((r): r is string => typeof r === 'string')
    : DEFAULT_SETTINGS.allowedRepos;

  const autoPreview = typeof raw.autoPreview === 'boolean'
    ? raw.autoPreview
    : DEFAULT_SETTINGS.autoPreview;

  const rawZoom = Number(raw.defaultZoom);
  const defaultZoom = Number.isFinite(rawZoom)
    ? Math.min(200, Math.max(25, rawZoom))
    : DEFAULT_SETTINGS.defaultZoom;

  return { allowedRepos, autoPreview, defaultZoom };
}
