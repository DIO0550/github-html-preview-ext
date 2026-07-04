type SendResponse = (response?: unknown) => void;

const previewStore = new Map<string, { html: string | null; error: string | null }>();
const PREVIEW_TTL_MS = 60_000;

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

/**
 * Open a brand new preview tab and respond with its tabId.
 * @param html - HTML content to display in the new preview tab
 * @param enableJavaScript - Whether to enable JS execution in the preview
 * @param sendResponse - Callback to deliver the response to the sender
 */
function createPreviewTab(
  html: string,
  enableJavaScript: boolean,
  sendResponse: SendResponse
): void {
  const previewId = crypto.randomUUID();
  previewStore.set(previewId, { html, error: null });
  setTimeout(() => previewStore.delete(previewId), PREVIEW_TTL_MS);

  const url = chrome.runtime.getURL(
    `src/preview.html?id=${previewId}&js=${enableJavaScript ? '1' : '0'}`
  );
  chrome.tabs.create({ url, active: true })
    .then(tab => sendResponse({ tabId: tab.id ?? null, error: null }))
    .catch(err => sendResponse({ tabId: null, error: err.message }));
}

/**
 * Handle the `open-preview-tab` message — focus an existing preview tab when
 * one is provided and still exists, otherwise create a new tab.
 * @param message - The incoming open-preview-tab message
 * @param sendResponse - Callback to deliver the response to the sender
 */
function handleOpenPreviewTab(
  message: { html: string; enableJavaScript: boolean; existingTabId: number | null },
  sendResponse: SendResponse
): void {
  const { html, enableJavaScript, existingTabId } = message;

  if (existingTabId == null || !Number.isInteger(existingTabId)) {
    createPreviewTab(html, enableJavaScript, sendResponse);
    return;
  }

  chrome.tabs.get(existingTabId)
    .then(() => chrome.tabs.update(existingTabId, { active: true }))
    .then(() => {
      chrome.tabs.sendMessage(existingTabId, {
        type: 'preview-update',
        html,
        enableJavaScript,
      }).catch(() => {
        // Receiver might not be ready yet; ignore — content script will retry via update-preview.
      });
      sendResponse({ tabId: existingTabId, error: null });
    })
    .catch(() => {
      // Tab no longer exists — fall back to creating a new one.
      createPreviewTab(html, enableJavaScript, sendResponse);
    });
}

/**
 * Handle the `update-preview` message — forward the new HTML to the preview tab.
 * Defensively rejects messages with a non-integer tabId so a stale content
 * script can't crash the service worker on `chrome.tabs.sendMessage`.
 * @param message - The incoming update-preview message
 * @param sendResponse - Callback to deliver the response to the sender
 */
function handleUpdatePreview(
  message: { tabId: number; html: string; enableJavaScript: boolean },
  sendResponse: SendResponse
): void {
  if (!Number.isInteger(message.tabId)) {
    sendResponse({ ok: false, error: 'Invalid tabId' });
    return;
  }
  chrome.tabs.sendMessage(message.tabId, {
    type: 'preview-update',
    html: message.html,
    enableJavaScript: message.enableJavaScript,
  })
    .then(() => sendResponse({ ok: true, error: null }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
}

/**
 * Handle the `check-preview-tab` message — verify whether the tab still exists.
 * Defensively rejects non-integer tabIds.
 * @param message - The incoming check-preview-tab message
 * @param sendResponse - Callback to deliver the response to the sender
 */
function handleCheckPreviewTab(
  message: { tabId: number },
  sendResponse: SendResponse
): void {
  if (!Number.isInteger(message.tabId)) {
    sendResponse({ exists: false });
    return;
  }
  chrome.tabs.get(message.tabId)
    .then(() => sendResponse({ exists: true }))
    .catch(() => sendResponse({ exists: false }));
}

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
    setTimeout(() => previewStore.delete(message.id), PREVIEW_TTL_MS);
    sendResponse({ ok: true });
  } else if (message.type === 'preview-get') {
    const data = previewStore.get(message.id);
    if (data) {
      // Keep the entry until its TTL expires so a reload of the preview tab
      // (same id in the URL) can re-fetch instead of timing out on a blank page.
      sendResponse(data);
    } else {
      sendResponse({ html: null, error: null, pending: true });
    }
  } else if (message.type === 'open-preview-tab') {
    handleOpenPreviewTab(message, sendResponse);
    return true;
  } else if (message.type === 'update-preview') {
    handleUpdatePreview(message, sendResponse);
    return true;
  } else if (message.type === 'check-preview-tab') {
    handleCheckPreviewTab(message, sendResponse);
    return true;
  }
  return true;
});
