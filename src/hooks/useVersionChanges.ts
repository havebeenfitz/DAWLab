import type { LogicChangeLine } from '@/pages/History/hooks/useWorkingChanges';
import { useEffect, useRef, useState } from 'react';
import type { FileDiff, PluginDiff } from '../../shared/version-diff';
import type { SongDiff, SongInfo } from '../../shared/song-diff';

export interface VersionChanges {
  commitId: string;
  parentId: string | null;
  parentMessage: string | null;
  files: FileDiff;
  plugins: PluginDiff | null;
  song?: SongInfo | null;
  songChanges?: SongDiff | null;
  /** What changed inside the Logic project, in words; null when not a Logic project. */
  logic?: LogicChangeLine[] | null;
}

/** Stands for "the unsaved changes in the folder" where a version id is expected. */
export const UNSAVED_ID = 'unsaved';

/**
 * What a version changed compared with the one before it (files and plugins).
 * With UNSAVED_ID: the unsaved changes compared with the last saved version;
 * `refreshKey` changes when they do.
 */
export function useVersionChanges(projectName: string | undefined, commitId: string | undefined | null, refreshKey = '') {
  const [changes, setChanges] = useState<VersionChanges | null>(null);
  const [loading, setLoading] = useState(false);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!projectName || !commitId) {
      shown.current = null;
      setChanges(null);
      return;
    }
    let cancelled = false;
    // Another version: clear and load. The same one refreshed (unsaved changes): keep the list until the new one is there.
    const key = `${projectName}|${commitId}`;
    if (shown.current !== key) { shown.current = key; setChanges(null); setLoading(true); }
    window.ipcRenderer.invoke('get-version-changes', projectName, commitId)
      .then((res: VersionChanges | null) => { if (!cancelled) setChanges(res ?? null); })
      .catch(() => { if (!cancelled) setChanges(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectName, commitId, refreshKey]);

  return { changes, loading };
}
