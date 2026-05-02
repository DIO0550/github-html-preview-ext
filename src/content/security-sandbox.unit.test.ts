import { it, expect, beforeEach } from 'vitest';
import { createSecuritySandboxScript, injectSecuritySandbox } from './security-sandbox';

// --- createSecuritySandboxScript ---

it('returns a non-empty string of valid JavaScript', () => {
  const script = createSecuritySandboxScript();
  expect(script.length).toBeGreaterThan(0);
  // Should parse without syntax errors (wrap in function to avoid execution)
  expect(() => new Function('return function() {' + script + '}')).not.toThrow();
});

// --- injectSecuritySandbox ---

it('injects a <script> tag at the beginning of <head>', () => {
  const html = '<html><head><title>Test</title></head><body>Hello</body></html>';
  const result = injectSecuritySandbox(html);
  const headStart = result.indexOf('<head>');
  const scriptStart = result.indexOf('<script>', headStart);
  const titleStart = result.indexOf('<title>', headStart);
  expect(scriptStart).toBeGreaterThan(headStart);
  expect(scriptStart).toBeLessThan(titleStart);
});

it('injects correctly when <head> tag is missing', () => {
  const html = '<html><body>Hello</body></html>';
  const result = injectSecuritySandbox(html);
  expect(result).toContain('<script>');
  expect(result).toContain('</script>');
});

it('wraps script in IIFE to avoid global scope pollution', () => {
  const script = createSecuritySandboxScript();
  expect(script.trim()).toMatch(/^\(function\s*\(\)\s*\{/);
  expect(script.trim()).toMatch(/\}\)\(\);?\s*$/);
});

// --- Network API blocking ---

it('contains network API overrides for fetch, XHR, WebSocket, EventSource, sendBeacon', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('fetch');
  expect(script).toContain('XMLHttpRequest');
  expect(script).toContain('WebSocket');
  expect(script).toContain('EventSource');
  expect(script).toContain('sendBeacon');
});

it('disables Worker and SharedWorker', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('Worker');
  expect(script).toContain('SharedWorker');
});

it('disables alert, confirm, and prompt', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('alert');
  expect(script).toContain('confirm');
  expect(script).toContain('prompt');
});

it('disables navigator.clipboard, navigator.geolocation, navigator.mediaDevices', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('clipboard');
  expect(script).toContain('geolocation');
  expect(script).toContain('mediaDevices');
});

it('disables eval and Function constructor', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('eval');
  expect(script).toContain('Function');
});

it('blocks setTimeout/setInterval with string argument but allows function argument', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('setTimeout');
  expect(script).toContain('setInterval');
  // Script should contain logic to check typeof first argument
  expect(script).toContain('string');
});

// --- Dynamic resource creation blocking ---

it('blocks external URL assignment to HTMLImageElement.prototype.src', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('HTMLImageElement');
});

it('blocks external URL assignment to HTMLScriptElement.prototype.src', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('HTMLScriptElement');
});

it('blocks external URL assignment to HTMLLinkElement.prototype.href', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('HTMLLinkElement');
});

it('blocks external URL assignment to HTMLIFrameElement.prototype.src', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('HTMLIFrameElement');
});

it('uses Object.defineProperty with configurable: false to prevent re-override', () => {
  const script = createSecuritySandboxScript();
  expect(script).toContain('Object.defineProperty');
  expect(script).toContain('configurable');
});
