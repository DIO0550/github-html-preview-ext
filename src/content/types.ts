export type FileHeaderInfo = {
  filePath: string;
  rawUrl: string;
  headerElement: Element;
};

export type ButtonState = 'idle' | 'loading' | 'error';

export type PreviewMode = 'new-tab' | 'inline' | 'panel';

export type PageType = 'pr-files' | 'commit' | 'blob-html' | 'unknown';

export type OpenPreviewTabMessage = {
  type: 'open-preview-tab';
  html: string;
  enableJavaScript: boolean;
  existingTabId: number | null;
};

export type OpenPreviewTabResponse = {
  tabId: number | null;
  error: string | null;
};

export type UpdatePreviewMessage = {
  type: 'update-preview';
  tabId: number;
  html: string;
  enableJavaScript: boolean;
};

export type UpdatePreviewResponse = {
  ok: boolean;
  error: string | null;
};

export type CheckPreviewTabMessage = {
  type: 'check-preview-tab';
  tabId: number;
};

export type CheckPreviewTabResponse = {
  exists: boolean;
};
