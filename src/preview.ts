import { handlePreviewMessage } from './preview-message-handler';

const params = new URLSearchParams(location.search);
const previewId = params.get('id');

const POLL_INTERVAL_MS = 200;
const PREVIEW_TIMEOUT_MS = 60_000;

/**
 * Poll the background script for preview HTML and display it.
 */
async function loadPreview(): Promise<void> {
  if (!previewId) return;

  const maxRetries = PREVIEW_TIMEOUT_MS / POLL_INTERVAL_MS;
  for (let i = 0; i < maxRetries; i++) {
    const data = await chrome.runtime.sendMessage({
      type: 'preview-get',
      id: previewId,
    });

    if (data.html || data.error) {
      handlePreviewMessage(
        { type: 'preview-get-response', id: previewId, html: data.html, error: data.error },
        previewId
      );
      return;
    }
    // pending: still fetching
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  // Timeout
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Preview timed out.';
}

loadPreview();
