export type FileHeaderInfo = {
  filePath: string;
  rawUrl: string;
  headerElement: Element;
};

export type ButtonState = 'idle' | 'loading' | 'error';

export type PreviewMode = 'new-tab' | 'inline' | 'panel';

export type PageType = 'pr-files' | 'blob-html' | 'unknown';
