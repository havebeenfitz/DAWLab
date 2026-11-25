/**
 * Helpers for comparing the project's files against the last checkout.
 */

/** Files modified more than this long after checkout count as unsaved changes
 * (the buffer covers the rollback itself writing files). */
export const UNSAVED_CHANGES_BUFFER_MS = 5000;

/** Parses a lastCheckout timestamp (YYYYMMDDHHmmss, saved in UTC) to epoch ms. */
export function parseCheckoutTimestamp(ts: string): number {
  const year = ts.slice(0, 4);
  const month = ts.slice(4, 6);
  const day = ts.slice(6, 8);
  const hour = ts.slice(8, 10);
  const min = ts.slice(10, 12);
  const sec = ts.slice(12, 14);
  // 'Z' parses as UTC (the backend saves via toISOString).
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).getTime();
}

/** True when the newest file write is later than the checkout plus the buffer. */
export function isModifiedSinceCheckout(fileModTime: number, checkoutTimestamp: string): boolean {
  return fileModTime > parseCheckoutTimestamp(checkoutTimestamp) + UNSAVED_CHANGES_BUFFER_MS;
}

/**
 * Asks the main process whether the project's files changed since `checkoutTimestamp`.
 * Resolves null when the save time couldn't be determined (result not successful).
 */
export async function detectChangesSinceCheckout(
  projectPath: string | null,
  checkoutTimestamp: string,
): Promise<boolean | null> {
  const result = await window.ipcRenderer.invoke("get-project-last-save-time", projectPath);
  if (!result.success) return null;
  return isModifiedSinceCheckout(result.latestModTime, checkoutTimestamp);
}
