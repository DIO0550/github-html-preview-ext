import { useState, useEffect } from 'react';
import type { ExtensionSettings } from '../shared/settings-types';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings-types';

const MIN_ZOOM = 25;
const MAX_ZOOM = 200;
const REPO_PATTERN = /^[^/]+\/(\*|[^/]+)$/;
const MAX_REPOS = 100;

/** @returns Options page root component */
function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [repoInput, setRepoInput] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get(DEFAULT_SETTINGS)
      .then((stored) => {
        setSettings(normalizeSettings(stored));
      })
      .catch(() => {
        // Fall back to defaults on error
      })
      .finally(() => {
        setLoaded(true);
      });
  }, []);

  /** @param next - Settings to persist to storage */
  const saveSettings = (next: ExtensionSettings) => {
    const prev = settings;
    setSettings(next);
    chrome.storage.sync.set(next).catch(() => {
      setSettings(prev);
      setError('Failed to save settings');
    });
  };

  /** Validate and add repo input to whitelist */
  const addRepo = () => {
    const value = repoInput.trim();
    if (!REPO_PATTERN.test(value)) {
      setError('Format: owner/repo or owner/*');
      return;
    }
    if (settings.allowedRepos.some((r) => r.toLowerCase() === value.toLowerCase())) {
      setError('Already in list');
      return;
    }
    if (settings.allowedRepos.length >= MAX_REPOS) {
      setError(`Maximum ${MAX_REPOS} entries`);
      return;
    }
    setError('');
    setRepoInput('');
    saveSettings({ ...settings, allowedRepos: [...settings.allowedRepos, value] });
  };

  /** @param index - Index of repo to remove from whitelist */
  const removeRepo = (index: number) => {
    const next = settings.allowedRepos.filter((_, i) => i !== index);
    saveSettings({ ...settings, allowedRepos: next });
  };

  /** Toggle auto-preview setting */
  const toggleAutoPreview = () => {
    saveSettings({ ...settings, autoPreview: !settings.autoPreview });
  };

  /** @param value - Zoom input string to parse, clamp, and save */
  const changeZoom = (value: string) => {
    const num = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) || MIN_ZOOM));
    saveSettings({ ...settings, defaultZoom: num });
  };

  if (!loaded) return null;

  return (
    <div className="min-h-screen bg-background p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-6">Extension Options</h1>

      {/* Whitelist Editor */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-2">Repository Whitelist</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Preview buttons are only shown for repositories in this list.
        </p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="owner/repo"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRepo()}
            className="flex-1 px-3 py-1.5 border border-border rounded-md bg-background text-foreground"
          />
          <button
            onClick={addRepo}
            className="px-4 py-1.5 bg-accent text-accent-foreground rounded-md hover:opacity-90"
          >
            Add
          </button>
        </div>
        {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
        <ul className="space-y-1">
          {settings.allowedRepos.map((repo, i) => (
            <li key={repo} className="flex items-center justify-between px-3 py-1.5 bg-muted rounded-md">
              <span className="text-foreground">{repo}</span>
              <button
                onClick={() => removeRepo(i)}
                className="text-sm text-muted-foreground hover:text-red-500"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Auto Preview Toggle */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-2">Auto Preview</h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoPreview}
            onChange={toggleAutoPreview}
            className="w-4 h-4"
          />
          <span className="text-foreground">Automatically preview HTML files on page load</span>
        </label>
      </section>

      {/* Default Zoom */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-2">Default Zoom</h2>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={10}
            value={settings.defaultZoom}
            onChange={(e) => changeZoom(e.target.value)}
            className="w-20 px-3 py-1.5 border border-border rounded-md bg-background text-foreground text-center"
          />
          <span className="text-muted-foreground">% (25-200)</span>
        </div>
      </section>
    </div>
  );
}

export default App;
