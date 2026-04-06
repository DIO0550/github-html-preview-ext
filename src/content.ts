import { getPageType } from './content/url-utils';
import { addPreviewButtons } from './content/github-dom';
import { startObserving } from './content/observer';
import { createBatchPreviewButton } from './content/batch-preview';

const BATCH_BUTTON_SELECTOR = '.html-preview-batch-btn';

startObserving(() => {
  const pageType = getPageType(location.pathname);
  if (pageType === 'unknown') return;

  addPreviewButtons(pageType);

  // Insert batch preview button on PR files page if not already present
  if (pageType === 'pr-files' && !document.querySelector(BATCH_BUTTON_SELECTOR)) {
    const batchBtn = createBatchPreviewButton();
    if (batchBtn) {
      // Insert near the top of the PR diff area
      const diffHeader = document.querySelector('#diff-header, .pr-toolbar, .diffbar');
      if (diffHeader) {
        diffHeader.appendChild(batchBtn);
      }
    }
  }
});
