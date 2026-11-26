import { useCallback, useState } from 'react';
import { useSharing } from '@/components/Sharing';
import { notify, errorMessage } from '@/lib/notify';

interface Target { name: string; folderId?: string | null }

/**
 * Renames a project with its folder and DAW file. In a shared folder only its
 * owner can, and the new name reaches everyone in the folder.
 */
export function useRenameProject(reload: () => void | Promise<void>) {
  const sharing = useSharing();
  const [target, setTarget] = useState<Target | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  /** Whether this Mac may rename it: anyone their own, only the owner in a shared folder. */
  const canRename = useCallback((project: Target | undefined) => {
    if (!project) return false;
    const folder = project.folderId ? sharing.folders[project.folderId] : undefined;
    return !folder || (folder.role === 'owner' && !folder.accessClosed);
  }, [sharing.folders]);

  const open = useCallback((project: Target) => { setTarget(project); setValue(project.name); }, []);
  const close = useCallback(() => { if (!busy) setTarget(null); }, [busy]);

  const submit = useCallback(async () => {
    if (!target) return;
    const next = value.trim();
    if (!next || next === target.name) { setTarget(null); return; }
    setBusy(true);
    try {
      const r = await (window.ipcRenderer.invoke('rename-project', target.name, next) as Promise<{ name: string; folderRenamed: boolean }>);
      notify.success(`Renamed to “${r.name}”`, r.folderRenamed ? 'Its folder on this Mac was renamed too.' : undefined);
      setTarget(null);
    } catch (err) {
      notify.error(`Couldn’t rename “${target.name}”`, errorMessage(err));
    } finally {
      setBusy(false);
      await sharing.refresh();
      await reload();
    }
  }, [target, value, sharing, reload]);

  return { target, value, setValue, busy, canRename, open, close, submit };
}
