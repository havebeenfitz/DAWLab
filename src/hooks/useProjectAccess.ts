import { useEffect, useState } from 'react';
import { hub, type SharedFolder, type SpaceRole } from '@/components/Sharing/hub';
import { useOptionalSharing } from '@/components/Sharing/SharingContext';

export interface ProjectAccess {
  /** The shared folder this project is in, if any. */
  folder: SharedFolder | null;
  /** owner/edit/listen in a shared folder; edit/listen for a project shared on its own; null if not shared. */
  role: SpaceRole | null;
  /** Listeners only play previews: no saving, restoring or alternatives. */
  isListener: boolean;
}

/** What this Mac may do with a project, given how it is shared. Updates when sharing changes. */
export function useProjectAccess(projectName: string | null | undefined): ProjectAccess {
  const sharing = useOptionalSharing();
  const [access, setAccess] = useState<ProjectAccess>({ folder: null, role: null, isListener: false });

  useEffect(() => {
    if (!projectName) return;
    let cancelled = false;
    (async () => {
      const folder = await hub.getProjectFolder(projectName).catch(() => null);
      const legacy = folder ? null : await hub.getRemote(projectName).catch(() => null);
      const role: SpaceRole | null = folder?.role ?? legacy?.role ?? null;
      if (!cancelled) setAccess({ folder, role, isListener: role === 'listen' });
    })();
    return () => { cancelled = true; };
  }, [projectName, sharing?.folders]);

  return access;
}
