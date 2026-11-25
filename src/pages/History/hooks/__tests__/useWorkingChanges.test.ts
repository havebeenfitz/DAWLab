import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkingChanges, RECHECK_MS } from '../useWorkingChanges';

const reply = { baseCommitId: 'c1', changes: [{ path: 'a.wav', kind: 'modified' }], dawOpen: null };

function mockIpc(impl: (...a: any[]) => unknown) {
  const invoke = vi.fn(impl);
  (window as any).ipcRenderer = { invoke, on: vi.fn(), off: vi.fn() };
  return invoke;
}

afterEach(() => { vi.useRealTimers(); });

describe('useWorkingChanges', () => {
  it('asks once on open and returns the changes', async () => {
    const invoke = mockIpc(async () => reply);
    const { result } = renderHook(() => useWorkingChanges('lodge', true, 'main'));
    await waitFor(() => expect(result.current.changes).toHaveLength(1));
    expect(invoke).toHaveBeenCalledWith('get-working-changes', 'lodge');
    expect(result.current.baseCommitId).toBe('c1');
  });

  it('does nothing when disabled (listeners, no folder)', async () => {
    const invoke = mockIpc(async () => reply);
    const { result } = renderHook(() => useWorkingChanges('lodge', false, 'main'));
    await act(async () => {});
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.changes).toEqual([]);
  });

  it('checks again on focus and every few seconds', async () => {
    vi.useFakeTimers();
    const invoke = mockIpc(async () => reply);
    renderHook(() => useWorkingChanges('lodge', true, 'main'));
    await act(async () => {});
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(RECHECK_MS); });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('shows nothing when the folder cannot be read', async () => {
    mockIpc(async () => { throw new Error('gone'); });
    const { result } = renderHook(() => useWorkingChanges('lodge', true, 'main'));
    await act(async () => {});
    expect(result.current.changes).toEqual([]);
  });
});
