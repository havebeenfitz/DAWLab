import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useProjectAccess } from '../useProjectAccess';
import { SharingProvider } from '@/components/Sharing/SharingContext';
import { captureIpcEvents, emitIpc, invokeCalls, mockInvoke } from '@/components/Sharing/__tests__/ipcTestUtils';
import { sharedFolder } from '@/components/Sharing/__tests__/fixtures';

captureIpcEvents();

const legacy = (role: 'edit' | 'listen') => ({ hubUrl: 'h', role, editUrl: 'https://h/s/x' });

describe('useProjectAccess', () => {
  it('starts unshared and asks nothing without a project name', async () => {
    mockInvoke({});
    const { result } = renderHook(() => useProjectAccess(null));
    await act(async () => {});
    expect(result.current).toEqual({ folder: null, role: null, isListener: false });
    expect(invokeCalls('hub-get-project-space')).toHaveLength(0);
  });

  it('uses the role in the shared folder and skips the legacy lookup', async () => {
    const folder = sharedFolder({ role: 'edit' });
    mockInvoke({ 'hub-get-project-space': () => folder, 'hub-get-remote': () => legacy('listen') });
    const { result } = renderHook(() => useProjectAccess('Song'));
    await waitFor(() => expect(result.current.role).toBe('edit'));
    expect(result.current).toEqual({ folder, role: 'edit', isListener: false });
    expect(invokeCalls('hub-get-project-space')).toEqual([['Song']]);
    expect(invokeCalls('hub-get-remote')).toHaveLength(0);
  });

  it('marks listeners in a shared folder', async () => {
    mockInvoke({ 'hub-get-project-space': () => sharedFolder({ role: 'listen' }) });
    const { result } = renderHook(() => useProjectAccess('Song'));
    await waitFor(() => expect(result.current.isListener).toBe(true));
    expect(result.current.role).toBe('listen');
  });

  it('owners are not listeners', async () => {
    mockInvoke({ 'hub-get-project-space': () => sharedFolder({ role: 'owner' }) });
    const { result } = renderHook(() => useProjectAccess('Song'));
    await waitFor(() => expect(result.current.role).toBe('owner'));
    expect(result.current.isListener).toBe(false);
  });

  it('falls back to the role of a project shared on its own', async () => {
    mockInvoke({ 'hub-get-project-space': () => null, 'hub-get-remote': () => legacy('listen') });
    const { result } = renderHook(() => useProjectAccess('Old Song'));
    await waitFor(() => expect(result.current.role).toBe('listen'));
    expect(result.current).toEqual({ folder: null, role: 'listen', isListener: true });
    expect(invokeCalls('hub-get-remote')).toEqual([['Old Song']]);
  });

  it('legacy collaborators are not listeners', async () => {
    mockInvoke({ 'hub-get-project-space': () => null, 'hub-get-remote': () => legacy('edit') });
    const { result } = renderHook(() => useProjectAccess('Old Song'));
    await waitFor(() => expect(result.current.role).toBe('edit'));
    expect(result.current.isListener).toBe(false);
  });

  it('is null when the project is not shared at all, even if lookups fail', async () => {
    mockInvoke({
      'hub-get-project-space': () => { throw new Error('offline'); },
      'hub-get-remote': () => { throw new Error('offline'); },
    });
    const { result } = renderHook(() => useProjectAccess('Song'));
    await waitFor(() => expect(invokeCalls('hub-get-remote')).toHaveLength(1));
    await act(async () => {});
    expect(result.current).toEqual({ folder: null, role: null, isListener: false });
  });

  it('looks again when the project changes', async () => {
    mockInvoke({
      'hub-get-project-space': (name: string) => (name === 'A' ? sharedFolder({ role: 'listen' }) : null),
      'hub-get-remote': () => null,
    });
    const { result, rerender } = renderHook(({ name }) => useProjectAccess(name), { initialProps: { name: 'A' } });
    await waitFor(() => expect(result.current.isListener).toBe(true));
    rerender({ name: 'B' });
    await waitFor(() => expect(result.current.role).toBeNull());
    expect(result.current.isListener).toBe(false);
  });

  it('ignores a late answer for a project it no longer shows', async () => {
    let resolveA: (v: unknown) => void = () => {};
    mockInvoke({
      'hub-get-project-space': (name: string) => (name === 'A' ? new Promise((r) => { resolveA = r; }) : sharedFolder({ role: 'edit' })),
    });
    const { result, rerender } = renderHook(({ name }) => useProjectAccess(name), { initialProps: { name: 'A' } });
    rerender({ name: 'B' });
    await waitFor(() => expect(result.current.role).toBe('edit'));
    await act(async () => { resolveA(sharedFolder({ role: 'listen' })); });
    expect(result.current.role).toBe('edit');
  });

  it('looks again when the shared folders change', async () => {
    let role: 'edit' | 'listen' = 'edit';
    mockInvoke({
      'hub-list-spaces': () => [sharedFolder({ role })],
      'hub-take-pending-join': () => null,
      'hub-get-project-space': () => sharedFolder({ role }),
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter><SharingProvider>{children}</SharingProvider></MemoryRouter>
    );
    const { result } = renderHook(() => useProjectAccess('Song'), { wrapper });
    await waitFor(() => expect(result.current.role).toBe('edit'));

    // The owner made this Mac a listener; the next sync reloads the folder list.
    role = 'listen';
    await act(async () => { emitIpc('hub-status', { folderId: 'f1', state: 'synced' }); });
    await waitFor(() => expect(result.current.isListener).toBe(true));
  });
});
