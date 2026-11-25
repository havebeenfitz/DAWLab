import { useEffect, useState } from 'react';
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
}

/** What a version changed compared with the one before it (files and plugins). */
export function useVersionChanges(projectName: string | undefined, commitId: string | undefined | null) {
  const [changes, setChanges] = useState<VersionChanges | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectName || !commitId) {
      setChanges(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.ipcRenderer.invoke('get-version-changes', projectName, commitId)
      .then((res: VersionChanges | null) => { if (!cancelled) setChanges(res ?? null); })
      .catch(() => { if (!cancelled) setChanges(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectName, commitId]);

  return { changes, loading };
}
