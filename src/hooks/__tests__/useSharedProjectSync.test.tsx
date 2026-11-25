import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/notify', async (orig) => ({ ...(await orig<typeof import('@/lib/notify')>()), notify }));

import { useSharedProjectSync } from '../useSharedProjectSync';

const invoke = window.ipcRenderer.invoke as unknown as ReturnType<typeof vi.fn>;
const statusListeners: Array<(e: unknown, s: unknown) => void> = [];

describe('useSharedProjectSync', () => {
  beforeEach(() => {
    invoke.mockReset();
    notify.success.mockReset();
    notify.error.mockReset();
    (window.ipcRenderer.on as any).mockImplementation((ch: string, cb: any) => { if (ch === 'hub-status') statusListeners.push(cb); });
  });

  it('checks for new versions on open and when the window comes back', async () => {
    invoke.mockImplementation(async (ch: string) => (ch === 'hub-project-incoming' ? 3 : null));
    const { result } = renderHook(() => useSharedProjectSync('Snow', 'f1', vi.fn()));
    await waitFor(() => expect(result.current.incoming).toBe(3));
    invoke.mockImplementation(async (ch: string) => (ch === 'hub-project-incoming' ? 5 : null));
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current.incoming).toBe(5));
  });

  it('pulls, refreshes the history, reports what happened and clears the badge', async () => {
    let waiting = 2;
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'hub-project-incoming') return waiting;
      if (ch === 'hub-sync-project-now') { waiting = 0; return { pulledVersions: 2, pushedVersions: 1 }; }
      return null;
    });
    const refresh = vi.fn();
    const { result } = renderHook(() => useSharedProjectSync('Snow', 'f1', refresh));
    await waitFor(() => expect(result.current.incoming).toBe(2));
    await act(async () => { await result.current.pull(); });
    expect(invoke).toHaveBeenCalledWith('hub-sync-project-now', 'Snow');
    expect(refresh).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith('“Snow” synced', '2 new versions pulled, 1 version sent');
    expect(result.current.incoming).toBe(0);
    expect(result.current.pulling).toBe(false);
  });

  it('explains a failed pull and keeps working', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'hub-sync-project-now') throw new Error("Error invoking remote method 'hub-sync-project-now': Error: offline");
      return 0;
    });
    const { result } = renderHook(() => useSharedProjectSync('Snow', 'f1', vi.fn()));
    await act(async () => { await result.current.pull(); });
    expect(notify.error).toHaveBeenCalledWith('Couldn’t sync “Snow”', 'offline');
    expect(result.current.pulling).toBe(false);
  });

  it('does nothing for projects that are not shared', async () => {
    const { result } = renderHook(() => useSharedProjectSync('Loose', undefined, vi.fn()));
    await act(async () => { await result.current.pull(); });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.incoming).toBe(0);
  });
});
