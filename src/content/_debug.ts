/**
 * Build-time debug flag. Set to `true` only during Stage 0 manual log capture
 * and reset to `false` before merging. With `false`, `if (DEBUG_AUTO_PREVIEW)`
 * blocks become dead code that minifiers can tree-shake away.
 */
export const DEBUG_AUTO_PREVIEW = false;

/**
 * Emit a console.debug entry prefixed with `[html-preview]`. Returns
 * immediately when the build-time flag is `false`.
 * @param args - Values to log
 */
export function debugLog(...args: unknown[]): void {
  if (!DEBUG_AUTO_PREVIEW) return;
  // eslint-disable-next-line no-console
  console.debug('[html-preview]', ...args);
}
