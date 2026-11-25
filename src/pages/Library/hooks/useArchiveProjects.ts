import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { notify } from '@/lib/notify';
import type { Project, Folder } from '@/types/library';

export const ARCHIVE_FOLDER_NAME = 'Archive';

/** The top-level "Archive" folder, if there is one. */
export const findArchiveFolder = (folders: Folder[]) =>
  folders.find(f => f.parentId === null && f.name === ARCHIVE_FOLDER_NAME) ?? null;

interface Options {
  folders: Folder[];
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  reload: () => unknown;
}

/**
 * "Archive": moves projects into a top-level Archive folder. Nothing is deleted;
 * versions and files stay, and dragging a project out brings it back.
 */
export function useArchiveProjects({ folders, setFolders, reload }: Options) {
  const [busy, setBusy] = useState(false);

  const archive = async (projects: Project[]) => {
    if (busy || projects.length === 0) return;
    setBusy(true);
    try {
      let target = findArchiveFolder(folders);
      if (!target) {
        target = (await window.ipcRenderer.invoke('create-folder', ARCHIVE_FOLDER_NAME, null)) as Folder;
        const created = target;
        setFolders(prev => [...prev, created]);
      }
      const moving = projects.filter(p => p.folderId !== target!.id);
      for (const p of moving) await window.ipcRenderer.invoke('move-project-to-folder', p.id, target.id);
      notify.success(moving.length === 1 ? `"${moving[0].name}" archived` : `${moving.length} projects archived`,
        'They are in the Archive folder. Nothing was deleted.');
    } catch (err) {
      notify.error('Couldn\'t archive projects', err);
    } finally {
      setBusy(false);
      await reload();
    }
  };

  return { archive, busy };
}
