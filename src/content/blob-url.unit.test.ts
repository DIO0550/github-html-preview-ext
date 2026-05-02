import { it, expect, vi, beforeEach } from 'vitest';
import { createBlobUrl, revokeBlobUrl } from './blob-url';

beforeEach(() => {
  vi.restoreAllMocks();
});

it('returns a URL starting with blob:', () => {
  const url = createBlobUrl('<html><body>Hello</body></html>');
  expect(url).toMatch(/^blob:/);
});

it('calls URL.revokeObjectURL with the provided URL', () => {
  const spy = vi.spyOn(URL, 'revokeObjectURL');
  const url = createBlobUrl('<html><body>Hello</body></html>');
  revokeBlobUrl(url);
  expect(spy).toHaveBeenCalledWith(url);
});
