const previewStore = new Map<string, { html: string | null; error: string | null }>();
const PREVIEW_TTL_MS = 60_000;

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'fetch-html') {
    // Fetch in background to avoid CORS restrictions in content script
    fetch(message.url, { credentials: 'include' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => sendResponse({ html, error: null }))
      .catch(err => sendResponse({ html: null, error: err.message }));
    return true;
  } else if (message.type === 'preview-store') {
    previewStore.set(message.id, { html: message.html, error: message.error ?? null });
    // Auto-cleanup after TTL
    setTimeout(() => previewStore.delete(message.id), PREVIEW_TTL_MS);
    sendResponse({ ok: true });
  } else if (message.type === 'preview-get') {
    const data = previewStore.get(message.id);
    if (data) {
      previewStore.delete(message.id);
      sendResponse(data);
    } else {
      sendResponse({ html: null, error: null, pending: true });
    }
  }
  return true;
});
