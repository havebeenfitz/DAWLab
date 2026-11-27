import { useCallback } from 'react';
import { hub, useSharing } from '@/components/Sharing';
import { askConfirm } from '@/lib/confirm';
import { notify } from '@/lib/notify';

/**
 * Folder owner only: deletes a shared project from the server, after asking.
 * Everyone loses it from the folder; the copy on this Mac stays, outside the folder.
 */
export function useDeleteFromServer(reload: () => void | Promise<void>) {
  const sharing = useSharing();

  /** The delete action for a project, or undefined when you don't own its shared folder. */
  return useCallback((project: { name: string; folderId?: string | null } | undefined) => {
    const folder = project?.folderId ? sharing.folders[project.folderId] : undefined;
    if (!project || !folder || folder.role !== 'owner' || folder.accessClosed) return undefined;
    return async () => {
      const ok = await askConfirm({
        title: `Delete “${project.name}” from the server?`,
        message: `Every version and file of it is deleted from the server, and it disappears from “${folder.name}” for everyone. This can’t be undone. Your copy on this Mac stays, with its history, outside the shared folder.`,
        confirmLabel: 'Delete from Server',
        danger: true,
      }, false);
      if (!ok) return;
      try {
        await hub.deleteFromServer(project.name);
        notify.success(`“${project.name}” deleted from the server`, 'Your copy is still here, outside the shared folder.');
      } catch (err) {
        notify.error(`Couldn’t delete “${project.name}” from the server`, err);
      } finally {
        await sharing.refresh();
        await reload();
      }
    };
  }, [sharing, reload]);
}
