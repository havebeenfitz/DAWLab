import { vi } from 'vitest';

/**
 * Test helpers for code that talks to the main process through window.ipcRenderer
 * (mocked in src/test/setup.ts).
 *
 * hub.ts subscribes to each IPC channel only once per module lifetime, so the
 * `on` capture must be installed before the first subscription and never reset.
 */
type IpcHandler = (event: unknown, payload: unknown) => void;
export type InvokeHandler = (...args: any[]) => unknown;

const handlers = new Map<string, IpcHandler[]>();

/** Replaces ipcRenderer.on with a recorder. Call once at the top of a test file. */
export function captureIpcEvents(): void {
  window.ipcRenderer.on = vi.fn((channel: string, handler: IpcHandler) => {
    handlers.set(channel, [...(handlers.get(channel) ?? []), handler]);
    return window.ipcRenderer;
  }) as any;
}

/** Sends an event from the "main process" to every registered renderer handler. */
export function emitIpc(channel: string, payload: unknown): void {
  for (const h of handlers.get(channel) ?? []) h({}, payload);
}

/** Number of ipcRenderer.on registrations seen for a channel. */
export function ipcRegistrations(channel: string): number {
  return handlers.get(channel)?.length ?? 0;
}

/**
 * Routes ipcRenderer.invoke by channel. Unknown channels resolve to undefined.
 * Handlers may throw (becomes a rejection) or return values/promises.
 */
export function mockInvoke(routes: Record<string, InvokeHandler>) {
  const invoke = vi.mocked(window.ipcRenderer.invoke);
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    const route = routes[channel];
    return route ? route(...args) : undefined;
  });
  return invoke;
}

/** All invoke calls on a channel, as argument lists (without the channel). */
export function invokeCalls(channel: string): unknown[][] {
  return vi.mocked(window.ipcRenderer.invoke).mock.calls
    .filter(([ch]) => ch === channel)
    .map(([, ...args]) => args);
}

/** The error Electron hands the renderer when a main-process handler throws. */
export function remoteError(channel: string, message: string): Error {
  return new Error(`Error invoking remote method '${channel}': Error: ${message}`);
}
