import { it, expect } from 'vitest';
import { createPreviewBridgeScript, injectPreviewBridge } from './preview-bridge-script';

it('emits a script that postMessages preview-content-size to parent', () => {
  const src = createPreviewBridgeScript();
  expect(src).toContain('preview-content-size');
  expect(src).toContain('parent.postMessage');
});

it('reads scrollHeight from documentElement', () => {
  const src = createPreviewBridgeScript();
  expect(src).toContain('documentElement');
  expect(src).toContain('scrollHeight');
});

it('attaches a MutationObserver for body changes', () => {
  const src = createPreviewBridgeScript();
  expect(src).toContain('MutationObserver');
});

it('listens for window load to re-measure', () => {
  const src = createPreviewBridgeScript();
  expect(src).toContain("addEventListener('load'");
});

it('injects script into existing <head>', () => {
  const html = '<html><head></head><body>x</body></html>';
  const result = injectPreviewBridge(html);
  expect(result).toContain('<head><script>');
  expect(result).toContain('preview-content-size');
});

it('creates <head> when only <body> exists', () => {
  const html = '<html><body>x</body></html>';
  const result = injectPreviewBridge(html);
  expect(result).toContain('<head><script>');
  expect(result.indexOf('<head>')).toBeLessThan(result.indexOf('<body>'));
});

it('prepends <head> when neither head nor body exist', () => {
  const html = 'plain text';
  const result = injectPreviewBridge(html);
  expect(result.startsWith('<head><script>')).toBe(true);
});
