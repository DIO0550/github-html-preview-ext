import { createViewportToggle } from './viewport-toggle';

const INLINE_WRAPPER_CLASS = 'html-preview-inline';

/**
 * Create an inline iframe preview inside a container element.
 * @param container - The DOM element to append the preview to
 * @param html - HTML content to render (should already have `<base>` injected)
 * @returns The created iframe element
 */
export function createInlinePreview(
  container: Element,
  html: string
): HTMLIFrameElement {
  const wrapper = document.createElement('div');
  wrapper.className = INLINE_WRAPPER_CLASS;
  wrapper.style.cssText = `
    border: 1px solid var(--color-border-default);
    border-radius: 6px;
    margin: 8px 0;
    overflow: hidden;
  `;

  const iframe = document.createElement('iframe');
  iframe.srcdoc = html;
  iframe.style.cssText = `
    width: 100%;
    height: 400px;
    border: none;
    resize: vertical;
    overflow: auto;
  `;
  iframe.setAttribute('sandbox', 'allow-scripts');

  const toggle = createViewportToggle(iframe);
  wrapper.appendChild(toggle);
  wrapper.appendChild(iframe);
  container.appendChild(wrapper);
  return iframe;
}

/**
 * Toggle inline preview visibility. Creates the preview on first call,
 * hides on second, shows on third, etc.
 * @param container - The DOM element containing the preview
 * @param html - HTML content to render
 */
export function toggleInlinePreview(container: Element, html: string): void {
  const existing = container.querySelector(`.${INLINE_WRAPPER_CLASS}`) as HTMLElement | null;
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? '' : 'none';
    return;
  }
  createInlinePreview(container, html);
}

/**
 * Remove the inline preview from a container, clearing iframe srcdoc first.
 * @param container - The DOM element containing the preview
 */
export function removeInlinePreview(container: Element): void {
  const wrapper = container.querySelector(`.${INLINE_WRAPPER_CLASS}`);
  if (!wrapper) return;

  const iframe = wrapper.querySelector('iframe');
  if (iframe) iframe.srcdoc = '';

  wrapper.remove();
}
