import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder, Project, AudioItem } from '@/types/library';
import {
  folderSubtree, isInSharedFolder, planFolderRemoval, planProjectRemoval, useRemoveFromLibrary,
} from '../useRemoveFromLibrary';

const notify = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/notify', () => ({ notify }));

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({ id, name, parentId, expanded: true, position: 0 }) as Folder;
const project = (id: string, name: string, folderId: string | null = null) =>
  ({ id, name, folderId }) as unknown as Project;

const folders = [folder('f1', 'Ableton'), folder('f2', 'Packs', 'f1'), folder('f3', 'Deep', 'f2'), folder('chig', 'Chigura')];
const projects = [
  project('p1', 'Drum Rack', 'f1'), project('p2', 'Bass', 'f2'), project('p3', 'Pad', 'f3'),
  project('p4', 'snow', 'chig'), project('p5', 'Loose', null),
];

describe('folder helpers', () => {
  it('lists a folder and its subfolders deepest first', () => {
    expect(folderSubtree(folders, 'f1')).toEqual(['f3', 'f2', 'f1']);
    expect(folderSubtree(folders, 'chig')).toEqual(['chig']);
  });

  it('finds shared ancestors and survives cycles', () => {
    expect(isInSharedFolder(folders, 'f3', { f1: {} })).toBe(true);
    expect(isInSharedFolder(folders, 'f3', { chig: {} })).toBe(false);
    expect(isInSharedFolder(folders, null, { f1: {} })).toBe(false);
    const loop = [folder('a', 'A', 'b'), folder('b', 'B', 'a')];
    expect(isInSharedFolder(loop, 'a', {})).toBe(false);
  });
});

describe('planFolderRemoval', () => {
  it('takes every project under the folder, nothing else', () => {
    const plan = planFolderRemoval(folders, projects, 'f1')!;
    expect(plan.projects.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(plan.folderIds).toEqual(['f3', 'f2', 'f1']);
    expect(plan.title).toBe('"Ableton"');
  });

  it('returns null for an unknown folder', () => {
    expect(planFolderRemoval(folders, projects, 'nope')).toBeNull();
  });
});

describe('planProjectRemoval', () => {
  it('uses the whole selection when the clicked project is in it', () => {
    const plan = planProjectRemoval(projects, 'p1', new Set(['project:p1', 'project:p5', 'audio:x']))!;
    expect(plan.projects.map(p => p.id)).toEqual(['p1', 'p5']);
    expect(plan.title).toBe('2 projects');
    expect(plan.folderIds).toEqual([]);
  });

  it('uses only the clicked project when it is outside the selection', () => {
    const plan = planProjectRemoval(projects, 'p4', new Set(['project:p1', 'project:p5']))!;
    expect(plan.projects.map(p => p.id)).toEqual(['p4']);
    expect(plan.title).toBe('"snow"');
  });

  it('returns null for an unknown project', () => {
    expect(planProjectRemoval(projects, 'zz', new Set())).toBeNull();
  });
});

describe('useRemoveFromLibrary', () => {
  const invoke = vi.fn();
  beforeEach(() => {
    invoke.mockReset();
    notify.success.mockReset();
    notify.error.mockReset();
    (window as unknown as { ipcRenderer: { invoke: typeof invoke } }).ipcRenderer = { invoke } as never;
  });

  function setup(audio: AudioItem[] = []) {
    const setFolders = vi.fn();
    const reload = vi.fn();
    const hook = renderHook(() => useRemoveFromLibrary({ setFolders, audioItems: audio, reload }));
    return { hook, setFolders, reload };
  }

  it('removes the projects, then the emptied folders, and reloads', async () => {
    invoke.mockImplementation(async (ch: string) =>
      ch === 'remove-projects-from-library' ? { removed: ['Drum Rack', 'Bass', 'Pad'], failed: [] } : true);
    const { hook, setFolders, reload } = setup();
    act(() => hook.result.current.setPlan(planFolderRemoval(folders, projects, 'f1')));
    await act(async () => { await hook.result.current.confirm(); });

    expect(invoke).toHaveBeenCalledWith('remove-projects-from-library', [
      { id: 'p1', name: 'Drum Rack' }, { id: 'p2', name: 'Bass' }, { id: 'p3', name: 'Pad' },
    ]);
    expect(invoke.mock.calls.filter(c => c[0] === 'delete-folder').map(c => c[1])).toEqual(['f3', 'f2', 'f1']);
    const updater = setFolders.mock.calls[0][0] as (f: Folder[]) => Folder[];
    expect(updater(folders).map(f => f.id)).toEqual(['chig']);
    expect(notify.success).toHaveBeenCalledWith('3 projects removed from DAWLab', 'Files on disk were not touched.');
    expect(reload).toHaveBeenCalled();
    expect(hook.result.current.plan).toBeNull();
  });

  it('keeps folders when something failed, and says what', async () => {
    invoke.mockResolvedValue({ removed: ['Drum Rack'], failed: [{ name: 'Bass', error: 'locked' }] });
    const { hook, setFolders } = setup();
    act(() => hook.result.current.setPlan(planFolderRemoval(folders, projects, 'f1')));
    await act(async () => { await hook.result.current.confirm(); });
    expect(invoke.mock.calls.some(c => c[0] === 'delete-folder')).toBe(false);
    expect(setFolders).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith('Removed 1, 1 failed', 'Bass: locked');
  });

  it('keeps folders that still hold audio', async () => {
    invoke.mockResolvedValue({ removed: ['Drum Rack', 'Bass', 'Pad'], failed: [] });
    const { hook, setFolders } = setup([{ id: 'a1', folderId: 'f2' } as AudioItem]);
    act(() => hook.result.current.setPlan(planFolderRemoval(folders, projects, 'f1')));
    await act(async () => { await hook.result.current.confirm(); });
    expect(invoke.mock.calls.some(c => c[0] === 'delete-folder')).toBe(false);
    expect(setFolders).not.toHaveBeenCalled();
  });

  it('says "Project removed" for one project and never touches folders', async () => {
    invoke.mockResolvedValue({ removed: ['snow'], failed: [] });
    const { hook } = setup();
    act(() => hook.result.current.setPlan(planProjectRemoval(projects, 'p4', new Set())));
    await act(async () => { await hook.result.current.confirm(); });
    expect(notify.success).toHaveBeenCalledWith('Project removed from DAWLab', 'Files on disk were not touched.');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports an IPC failure and still closes and reloads', async () => {
    invoke.mockRejectedValue(new Error('boom'));
    const { hook, reload } = setup();
    act(() => hook.result.current.setPlan(planProjectRemoval(projects, 'p4', new Set())));
    await act(async () => { await hook.result.current.confirm(); });
    expect(notify.error).toHaveBeenCalledWith("Couldn't remove projects", expect.any(Error));
    expect(reload).toHaveBeenCalled();
    expect(hook.result.current.plan).toBeNull();
  });

  it('does nothing without a plan; cancel clears the plan', async () => {
    const { hook } = setup();
    await act(async () => { await hook.result.current.confirm(); });
    expect(invoke).not.toHaveBeenCalled();
    act(() => hook.result.current.setPlan(planProjectRemoval(projects, 'p4', new Set())));
    act(() => hook.result.current.cancel());
    expect(hook.result.current.plan).toBeNull();
  });
});
