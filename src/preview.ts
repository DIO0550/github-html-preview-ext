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

/**
 * Listen for `preview-update` messages from the background script. The
 * background forwards updates to this tab whenever the user navigates to a
 * different HTML file in the GitHub Code tab while this preview is open.
 */
chrome.runtime.onMessage.addListener((message: { type?: string; html?: string | null; enableJavaScript?: boolean }) => {
  if (message.type !== 'preview-update') return;
  handlePreviewMessage(
    {
      type: 'preview-update',
      id: previewId ?? '',
      html: message.html ?? null,
      error: null,
      enableJavaScript: message.enableJavaScript,
    },
    previewId ?? ''
  );
});

loadPreview();
