type PreviewMessage = {
  type: string;
  id: string;
  html: string | null;
  error: string | null;
};

/**
 * Handle a preview message by writing HTML to the iframe or showing an error.
 * @param message - The message containing preview data
 * @param expectedId - The expected preview ID to match
 */
export function handlePreviewMessage(message: PreviewMessage, expectedId: string): void {
  if (message.id !== expectedId) return;

  const loading = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const iframe = document.getElementById('preview') as HTMLIFrameElement | null;

  if (message.html) {
    if (loading) loading.style.display = 'none';
    if (iframe) {
      iframe.style.display = 'block';
      iframe.srcdoc = message.html;
    }
  } else if (message.error) {
    if (loading) loading.style.display = 'none';
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = message.error;
    }
  }
}
