import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Folder, Project } from '@/types/library';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/notify', () => ({ notify }));

import { useArchiveProjects, findArchiveFolder } from '../useArchiveProjects';

const folder = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId, position: 0 }) as Folder;
const project = (id: string, name: string, folderId: string | null = null) => ({ id, name, folderId }) as Project;

describe('useArchiveProjects', () => {
  const invoke = vi.fn();
  beforeEach(() => {
    invoke.mockReset(); notify.success.mockReset(); notify.error.mockReset();
    (window as unknown as { ipcRenderer: unknown }).ipcRenderer = { invoke };
  });

  it('finds only a top-level Archive folder', () => {
    expect(findArchiveFolder([folder('a', 'Archive', 'x')])).toBeNull();
    expect(findArchiveFolder([folder('b', 'Archive')])?.id).toBe('b');
  });

  it('creates the Archive folder once and moves the projects into it', async () => {
    invoke.mockImplementation(async (ch: string) => (ch === 'create-folder' ? folder('arc', 'Archive') : { success: true }));
    const setFolders = vi.fn();
    const reload = vi.fn();
    const hook = renderHook(() => useArchiveProjects({ folders: [], setFolders, reload }));
    await act(async () => { await hook.result.current.archive([project('p1', 'a'), project('p2', 'b')]); });
    expect(invoke).toHaveBeenCalledWith('create-folder', 'Archive', null);
    expect(invoke.mock.calls.filter(c => c[0] === 'move-project-to-folder').map(c => c.slice(1))).toEqual([['p1', 'arc'], ['p2', 'arc']]);
    expect(setFolders).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith('2 projects archived', expect.any(String));
    expect(reload).toHaveBeenCalled();
  });

  it('reuses an existing Archive folder and skips projects already in it', async () => {
    invoke.mockResolvedValue({ success: true });
    const hook = renderHook(() => useArchiveProjects({ folders: [folder('arc', 'Archive')], setFolders: vi.fn(), reload: vi.fn() }));
    await act(async () => { await hook.result.current.archive([project('p1', 'a', 'arc'), project('p2', 'b')]); });
    expect(invoke).not.toHaveBeenCalledWith('create-folder', expect.anything(), expect.anything());
    expect(invoke.mock.calls.map(c => c.slice(0, 3))).toEqual([['move-project-to-folder', 'p2', 'arc']]);
  });
});
