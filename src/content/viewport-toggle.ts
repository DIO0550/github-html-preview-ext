type ViewportName = 'mobile' | 'tablet' | 'desktop';

const VIEWPORTS: Record<ViewportName, { width: string; label: string }> = {
  mobile:  { width: '375px',  label: 'Mobile' },
  tablet:  { width: '768px',  label: 'Tablet' },
  desktop: { width: '100%',   label: 'Desktop' },
};

/**
 * Set an iframe's width to match a named viewport preset.
 * @param iframe - The iframe element to resize
 * @param viewport - Viewport name ('mobile', 'tablet', or 'desktop')
 */
export function setViewport(iframe: HTMLIFrameElement, viewport: ViewportName): void {
  iframe.style.width = VIEWPORTS[viewport].width;
}

/**
 * Create a viewport toggle button group that controls an iframe's width.
 * @param iframe - The iframe element to control
 * @returns A container element with Mobile/Tablet/Desktop buttons
 */
export function createViewportToggle(iframe: HTMLIFrameElement): HTMLElement {
  const container = document.createElement('div');
  container.className = 'html-preview-viewport-toggle';
  container.style.cssText = 'display: flex; gap: 4px; padding: 4px 0;';

  const viewportNames: ViewportName[] = ['mobile', 'tablet', 'desktop'];
  const buttons: HTMLButtonElement[] = [];

  for (const name of viewportNames) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.textContent = VIEWPORTS[name].label;
    if (name === 'desktop') btn.classList.add('selected');

    btn.addEventListener('click', () => {
      setViewport(iframe, name);
      for (const b of buttons) b.classList.remove('selected');
      btn.classList.add('selected');
    });

    buttons.push(btn);
    container.appendChild(btn);
  }

  return container;
}
