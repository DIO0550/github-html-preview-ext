/**
 * Blob URL utility for iframe preview rendering.
 * Provides creation and revocation of blob URLs for HTML content.
 */

/**
 * Create a blob URL from an HTML string for use as iframe src.
 * @param html - The HTML content
 * @returns A blob: URL string
 */
export function createBlobUrl(html: string): string {
  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

/**
 * Revoke a previously created blob URL to free memory.
 * @param url - The blob URL to revoke
 */
export function revokeBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}
