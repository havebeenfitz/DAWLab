import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharingProvider, announceLibraryChange, useOptionalSharing, useSharing } from '../SharingContext';
import type { SyncStatus } from '../hub';
import { dismissNotice, subscribeNotices, type Notice } from '@/lib/notify';
import { captureIpcEvents, emitIpc, invokeCalls, mockInvoke, type InvokeHandler } from './ipcTestUtils';
import { sharedFolder, spaceDetails } from './fixtures';

captureIpcEvents();

type Ctx = ReturnType<typeof useSharing>;
let ctx: Ctx;
function Probe() {
  ctx = useSharing();
  const loc = useLocation();
  return (
    <>
      <div data-testid="folders">{Object.keys(ctx.folders).join(',')}</div>
      <div data-testid="status">{Object.values(ctx.status).map((s) => `${s.folderId}:${s.state}`).join(',')}</div>
      <div data-testid="location">{loc.pathname}</div>
    </>
  );
}

const album = sharedFolder();
const flush = () => new Promise((r) => setTimeout(r, 0));

async function renderProvider(routes: Record<string, InvokeHandler> = {}, initialPath = '/project/Song') {
  mockInvoke({
    'hub-list-spaces': () => [album],
    'hub-take-pending-join': () => null,
    'hub-default-join-dir': () => '/Users/me/Music',
    'hub-get-settings': () => ({ hubUrl: 'https://hub.test', hasKey: true }),
    'hub-space-details': () => spaceDetails(album),
    'hub-list-invites': () => [],
    'hub-get-project-space': () => null,
    'hub-get-remote': () => null,
    'hub-project-share-context': () => ({ projectId: 'p1', folderId: 'f2', folderName: 'Beats' }),
    ...routes,
  });
  const utils = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SharingProvider>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </SharingProvider>
    </MemoryRouter>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return utils;
}

function currentNotices(): Notice[] {
  let seen: Notice[] = [];
  subscribeNotices((n) => { seen = n; })();
  return seen;
}

const libraryChanged = vi.fn();
beforeEach(() => {
  for (const n of currentNotices()) dismissNotice(n.id);
  libraryChanged.mockReset();
  window.addEventListener('dawlab:library-changed', libraryChanged);
  sessionStorage.clear();
});
afterEach(() => {
  window.removeEventListener('dawlab:library-changed', libraryChanged);
});

const status = (s: Partial<SyncStatus>): SyncStatus => ({ folderId: 'f1', state: 'synced', ...s });

describe('SharingProvider', () => {
  it('loads shared folders keyed by Library folder id', async () => {
    await renderProvider();
    expect(screen.getByTestId('folders')).toHaveTextContent('f1');
    expect(ctx.folders.f1).toEqual(album);
    expect(invokeCalls('hub-list-spaces')).toHaveLength(1);
  });

  it('treats a failing list as nothing shared', async () => {
    await renderProvider({ 'hub-list-spaces': () => { throw new Error('No user yet'); } });
    expect(ctx.folders).toEqual({});
  });

  it('refresh() reloads the list', async () => {
    let list = [album];
    await renderProvider({ 'hub-list-spaces': () => list });
    list = [album, sharedFolder({ folderId: 'f2', name: 'EP' })];
    await act(async () => { await ctx.refresh(); });
    expect(screen.getByTestId('folders')).toHaveTextContent('f1,f2');
  });

  describe('hub-status events', () => {
    it('keeps the latest status per folder without reloading while syncing', async () => {
      await renderProvider();
      act(() => { emitIpc('hub-status', status({ state: 'syncing', message: 'Uploading' })); });
      expect(screen.getByTestId('status')).toHaveTextContent('f1:syncing');
      expect(ctx.status.f1.message).toBe('Uploading');
      expect(invokeCalls('hub-list-spaces')).toHaveLength(1);
      expect(libraryChanged).not.toHaveBeenCalled();
    });

    it('reloads folders when a sync ends', async () => {
      await renderProvider();
      await act(async () => { emitIpc('hub-status', status({ state: 'synced', result: { pushedVersions: 1, pulledVersions: 0, addedProjects: [], failed: [] } })); });
      expect(screen.getByTestId('status')).toHaveTextContent('f1:synced');
      await waitFor(() => expect(invokeCalls('hub-list-spaces')).toHaveLength(2));
      expect(libraryChanged).not.toHaveBeenCalled();
      expect(currentNotices()).toHaveLength(0);
    });

    it('announces a Library change and shows a notice when new projects and versions arrived', async () => {
      await renderProvider();
      await act(async () => {
        emitIpc('hub-status', status({ result: { pushedVersions: 0, pulledVersions: 3, addedProjects: ['A', 'B'], failed: [] } }));
      });
      expect(libraryChanged).toHaveBeenCalledTimes(1);
      expect(currentNotices()).toEqual([
        expect.objectContaining({ kind: 'info', title: 'Shared folder updated', detail: '2 new projects, 3 new versions' }),
      ]);
    });

    it('uses singular wording for one project or one version', async () => {
      await renderProvider();
      await act(async () => {
        emitIpc('hub-status', status({ result: { pushedVersions: 0, pulledVersions: 0, addedProjects: ['A'], failed: [] } }));
      });
      expect(currentNotices()[0].detail).toBe('1 new project');
      await act(async () => {
        emitIpc('hub-status', status({ result: { pushedVersions: 0, pulledVersions: 1, addedProjects: [], failed: [] } }));
      });
      expect(currentNotices()[1].detail).toBe('1 new version');
    });

    it('announces but does not show a notice when a sync that pulled versions ended in error', async () => {
      await renderProvider();
      await act(async () => {
        emitIpc('hub-status', status({ state: 'error', error: 'timeout', result: { pushedVersions: 0, pulledVersions: 2, addedProjects: [], failed: [] } }));
      });
      expect(libraryChanged).toHaveBeenCalledTimes(1);
      expect(currentNotices()).toHaveLength(0);
      expect(ctx.status.f1.state).toBe('error');
    });

    it('stops listening after unmount', async () => {
      const { unmount } = await renderProvider();
      unmount();
      emitIpc('hub-status', status({ result: { pushedVersions: 0, pulledVersions: 1, addedProjects: [], failed: [] } }));
      expect(libraryChanged).not.toHaveBeenCalled();
    });
  });

  describe('joining', () => {
    it('opens the join dialog prefilled when a join link arrives', async () => {
      await renderProvider();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await act(async () => { emitIpc('join-shared', 'dawlab://join/ABC'); });
      expect(screen.getByRole('dialog', { name: 'Join a shared folder' })).toBeInTheDocument();
      expect(screen.getByLabelText('Invite')).toHaveValue('dawlab://join/ABC');
    });

    it('opens the join dialog with the link that launched the app', async () => {
      await renderProvider({ 'hub-take-pending-join': () => 'dawlab://join/LAUNCH' });
      expect(screen.getByLabelText('Invite')).toHaveValue('dawlab://join/LAUNCH');
    });

    it('ignores a failing pending-join lookup', async () => {
      await renderProvider({ 'hub-take-pending-join': () => { throw new Error('x'); } });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('join() opens it empty, and Cancel closes it', async () => {
      await renderProvider();
      await act(async () => { ctx.join(); await flush(); });
      expect(screen.getByLabelText('Invite')).toHaveValue('');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('after joining: reloads, remembers the folder, goes to the Library and announces it', async () => {
      await renderProvider({
        'hub-preview-invite': () => ({ hubUrl: 'h', space: { id: 's', name: 'Album' }, role: 'edit', invitedBy: 'Ann', projectCount: 1, memberCount: 2, expiresAt: '2026-12-31' }),
        'hub-join-space': () => ({ ...album, folderId: 'joined-1', addedProjects: [], failed: [] }),
      });
      await act(async () => { ctx.join('DAWL-7KQ4-MX2P-9TRB'); await flush(); });
      await screen.findByText('Shared by Ann · 1 project · 2 people');
      fireEvent.click(screen.getByRole('button', { name: 'Join' }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
      expect(sessionStorage.getItem('dawlab-current-folder')).toBe('joined-1');
      expect(libraryChanged).toHaveBeenCalledWith(expect.objectContaining({ detail: { folderId: 'joined-1' } }));
      expect(invokeCalls('hub-list-spaces').length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('sharing', () => {
    it('shareFolder() opens the folder dialog for that folder', async () => {
      await renderProvider();
      await act(async () => { ctx.shareFolder('f1', 'Album'); await flush(); });
      expect(screen.getByRole('dialog', { name: '“Album” is shared' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shareFolder() for a folder that is not shared offers to share it', async () => {
      await renderProvider();
      await act(async () => { ctx.shareFolder('f9', 'Demos'); await flush(); });
      expect(screen.getByRole('dialog', { name: 'Share “Demos”' })).toBeInTheDocument();
    });

    it('shareProject() for a project in a plain folder offers that folder, then hands over', async () => {
      await renderProvider();
      await act(async () => { ctx.shareProject('Song'); await flush(); });
      fireEvent.click(await screen.findByRole('button', { name: 'Share the folder “Beats”' }));
      await act(async () => { await flush(); });
      expect(screen.getByRole('dialog', { name: 'Share “Beats”' })).toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('shareProject() for a project in a shared folder opens the folder dialog directly', async () => {
      await renderProvider({ 'hub-get-project-space': () => album });
      await act(async () => { ctx.shareProject('Song'); await flush(); });
      expect(await screen.findByRole('dialog', { name: '“Album” is shared' })).toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('regression: an open project share dialog is not reloaded (and reset) by unrelated provider updates', async () => {
      await renderProvider();
      await act(async () => { ctx.shareProject('Song'); await flush(); });
      await screen.findByRole('button', { name: 'Share the folder “Beats”' });
      expect(invokeCalls('hub-get-project-space')).toHaveLength(1);

      // A background sync status for some folder re-renders the provider.
      act(() => { emitIpc('hub-status', status({ folderId: 'f1', state: 'syncing' })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

      expect(invokeCalls('hub-get-project-space')).toHaveLength(1);
    });

    it('regression: an error in the project share dialog is not wiped by a background sync status', async () => {
      await renderProvider({
        'hub-make-folder-for-project': () => { throw new Error("Error invoking remote method 'hub-make-folder-for-project': Error: Disk full"); },
      });
      await act(async () => { ctx.shareProject('Song'); await flush(); });
      fireEvent.click(screen.getByRole('button', { name: /Share only this project/ }));
      expect(await screen.findByText('Disk full')).toBeInTheDocument();

      await act(async () => { emitIpc('hub-status', status({ folderId: 'f1', state: 'syncing' })); await flush(); });

      expect(screen.getByText('Disk full')).toBeInTheDocument();
    });
  });
});

describe('announceLibraryChange', () => {
  it('dispatches dawlab:library-changed with the folder id', () => {
    const cb = vi.fn();
    window.addEventListener('dawlab:library-changed', cb);
    announceLibraryChange('f7');
    announceLibraryChange();
    window.removeEventListener('dawlab:library-changed', cb);
    expect(cb.mock.calls.map(([e]) => (e as CustomEvent).detail)).toEqual([{ folderId: 'f7' }, { folderId: undefined }]);
  });
});

describe('useSharing outside the provider', () => {
  it('throws a clear error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSharing())).toThrow('useSharing must be used inside <SharingProvider>');
    spy.mockRestore();
  });

  it('useOptionalSharing returns null', () => {
    const { result } = renderHook(() => useOptionalSharing());
    expect(result.current).toBeNull();
  });
});
