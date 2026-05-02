import { it, expect } from 'vitest';
import { sanitizeHtml } from './html-sanitizer';

// --- External URL tag removal ---

it('removes <img> tags with external http:// src', () => {
  const html = '<html><head></head><body><img src="http://evil.com/track.png"></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
  expect(result).not.toContain('<img');
});

it('removes <img> tags with external https:// src', () => {
  const html = '<html><head></head><body><img src="https://evil.com/track.png"></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
});

it('removes <script> tags with external src', () => {
  const html = '<html><head><script src="https://evil.com/malware.js"></script></head><body></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
  expect(result).not.toContain('malware.js');
});

it('removes <link> tags with external href', () => {
  const html = '<html><head><link rel="stylesheet" href="https://evil.com/style.css"></head><body></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
});

it('removes <iframe> tags with external src', () => {
  const html = '<html><body><iframe src="https://evil.com/frame"></iframe></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
});

it('removes <video> tags with external src', () => {
  const html = '<html><body><video src="https://evil.com/vid.mp4"></video></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
});

it('removes <audio> tags with external src', () => {
  const html = '<html><body><audio src="https://evil.com/audio.mp3"></audio></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
});

it('removes <source> tags with external src', () => {
  const html = '<html><body><video><source src="https://evil.com/vid.mp4"></video></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
});

it('removes <object> tags with external data', () => {
  const html = '<html><body><object data="https://evil.com/obj"></object></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
});

it('removes <embed> tags with external src', () => {
  const html = '<html><body><embed src="https://evil.com/embed"></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
});

// --- Relative paths and data URIs should be preserved ---

it('preserves <img> tags with relative src', () => {
  const html = '<html><body><img src="images/photo.png"></body></html>';
  const result = sanitizeHtml(html);
  expect(result).toContain('images/photo.png');
});

it('preserves <img> tags with data: URI', () => {
  const html = '<html><body><img src="data:image/png;base64,abc123"></body></html>';
  const result = sanitizeHtml(html);
  expect(result).toContain('data:image/png;base64,abc123');
});

it('preserves <script> tags without src (inline scripts)', () => {
  const html = '<html><head><script>console.log("hi")</script></head><body></body></html>';
  const result = sanitizeHtml(html);
  expect(result).toContain('console.log');
});

it('preserves <link> tags with relative href', () => {
  const html = '<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>';
  const result = sanitizeHtml(html);
  expect(result).toContain('style.css');
});

// --- meta refresh removal ---

it('removes <meta http-equiv="refresh"> tags', () => {
  const html = '<html><head><meta http-equiv="refresh" content="0;url=https://evil.com"></head><body></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('refresh');
  expect(result).not.toContain('evil.com');
});

it('removes <meta http-equiv="Refresh"> (case insensitive)', () => {
  const html = '<html><head><meta http-equiv="Refresh" content="5"></head><body></body></html>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('Refresh');
});

it('preserves normal <meta> tags like charset', () => {
  const html = '<html><head><meta charset="utf-8"></head><body></body></html>';
  const result = sanitizeHtml(html);
  expect(result).toContain('charset');
});

// --- Edge cases ---

it('handles HTML without <head> tag', () => {
  const html = '<body><img src="https://evil.com/x.png"><p>Hello</p></body>';
  const result = sanitizeHtml(html);
  expect(result).not.toContain('evil.com');
  expect(result).toContain('Hello');
});

it('returns valid HTML when input has no external resources', () => {
  const html = '<html><head><title>Safe</title></head><body><p>OK</p></body></html>';
  const result = sanitizeHtml(html);
  expect(result).toContain('Safe');
  expect(result).toContain('OK');
});
