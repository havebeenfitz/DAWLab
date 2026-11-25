import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { notify } from '@/lib/notify';
import { shouldSkipWarning } from '@/components/WarningModal/WarningModal';

export const REMOVE_WARNING = 'remove-from-library';
import type { Project, Folder, AudioItem } from '@/types/library';

export interface RemovalPlan {
  /** What the dialog names: a folder, one project, or "N projects". */
  title: string;
  projects: Project[];
  /** Library folders to drop afterwards (the chosen folder and its subfolders), deepest first. */
  folderIds: string[];
}

/** The folder and all folders under it, deepest first. */
export function folderSubtree(folders: Folder[], rootId: string): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    for (const f of folders) if (f.parentId === id) visit(f.id);
    out.push(id);
  };
  visit(rootId);
  return out;
}

/** True when the folder or any folder above it is shared. */
export function isInSharedFolder(folders: Folder[], folderId: string | null | undefined, shared: Record<string, unknown>): boolean {
  const seen = new Set<string>();
  let id = folderId ?? null;
  while (id && !seen.has(id)) {
    if (shared[id]) return true;
    seen.add(id);
    id = folders.find(f => f.id === id)?.parentId ?? null;
  }
  return false;
}

export function planFolderRemoval(folders: Folder[], projects: Project[], folderId: string): RemovalPlan | null {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return null;
  const ids = folderSubtree(folders, folderId);
  const inTree = new Set(ids);
  return {
    title: `"${folder.name}"`,
    projects: projects.filter(p => p.folderId && inTree.has(p.folderId)),
    folderIds: ids,
  };
}

/** The clicked project, or the whole selection when the clicked project is part of it. */
export function planProjectRemoval(projects: Project[], clickedId: string, selectionKeys: Set<string>): RemovalPlan | null {
  const clicked = projects.find(p => p.id === clickedId);
  if (!clicked) return null;
  const selectedIds = Array.from(selectionKeys).filter(k => k.startsWith('project:')).map(k => k.slice('project:'.length));
  const chosen = selectionKeys.has(`project:${clickedId}`) && selectedIds.length > 1
    ? projects.filter(p => selectedIds.includes(p.id))
    : [clicked];
  return {
    title: chosen.length === 1 ? `"${chosen[0].name}"` : `${chosen.length} projects`,
    projects: chosen,
    folderIds: [],
  };
}

interface Options {
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  audioItems: AudioItem[];
  reload: () => unknown;
}

/** "Remove from DAWLab": confirm, then take projects (and emptied folders) out of the library, files stay on disk. */
export function useRemoveFromLibrary({ setFolders, audioItems, reload }: Options) {
  const [plan, setPlan] = useState<RemovalPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (plan: RemovalPlan | null) => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const res: { removed: string[]; failed: { name: string; error: string }[] } =
        await window.ipcRenderer.invoke('remove-projects-from-library', plan.projects.map(p => ({ id: p.id, name: p.name })));
      // Drop the folders only if everything in them went and no audio is left inside.
      if (plan.folderIds.length && res.failed.length === 0) {
        const doomed = new Set(plan.folderIds);
        const hasAudio = audioItems.some(a => a.folderId && doomed.has(a.folderId));
        if (!hasAudio) {
          for (const id of plan.folderIds) await window.ipcRenderer.invoke('delete-folder', id);
          setFolders(prev => prev.filter(f => !doomed.has(f.id)));
        }
      }
      if (res.failed.length) {
        notify.error(`Removed ${res.removed.length}, ${res.failed.length} failed`, res.failed.map(f => `${f.name}: ${f.error}`).join('\n'));
      } else {
        notify.success(res.removed.length === 1 ? 'Project removed from DAWLab' : `${res.removed.length} projects removed from DAWLab`, 'Files on disk were not touched.');
      }
    } catch (err) {
      notify.error('Couldn\'t remove projects', err);
    } finally {
      setBusy(false);
      setPlan(null);
      await reload();
    }
  };

  const confirm = () => run(plan);

  /** Shows the confirmation, or removes right away when the user ticked "Don't ask me again". */
  const request = async (next: RemovalPlan | null) => {
    if (!next) return;
    let skip = false;
    try { skip = await shouldSkipWarning(REMOVE_WARNING); } catch { skip = false; }
    if (skip) await run(next);
    else setPlan(next);
  };

  return { plan, setPlan, request, busy, confirm, cancel: () => { if (!busy) setPlan(null); } };
}
