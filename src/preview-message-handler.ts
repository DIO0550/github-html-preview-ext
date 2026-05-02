import { createBlobUrl, revokeBlobUrl } from './content/blob-url';

type PreviewMessage = {
  type: string;
  id: string;
  html: string | null;
  error: string | null;
  enableJavaScript?: boolean;
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
      // Revoke previous blob URL if any
      if (iframe.src && iframe.src.startsWith('blob:')) {
        revokeBlobUrl(iframe.src);
      }
      iframe.style.display = 'block';
      const enableJS = message.enableJavaScript !== false;
      iframe.setAttribute('sandbox', enableJS ? 'allow-scripts' : '');
      const blobUrl = createBlobUrl(message.html);
      iframe.src = blobUrl;
    }
  } else if (message.error) {
    if (loading) loading.style.display = 'none';
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = message.error;
    }
  }
}
