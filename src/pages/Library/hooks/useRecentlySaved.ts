import { useCallback, useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';

export interface RecentlySavedProject {
  id: string;
  name: string;
  path: string;
  daw?: string;
  latestModTime?: string;
}

const HANDLED_MOD_TIMES_KEY = 'dawlab-handled-mod-times';

function loadHandledModTimes(): Map<string, string> {
  const stored = localStorage.getItem(HANDLED_MOD_TIMES_KEY);
  if (stored) {
    try {
      return new Map(JSON.parse(stored));
    } catch {
      return new Map();
    }
  }
  return new Map();
}

/**
 * The "Recently saved X — Open" toast: the first project whose files changed
 * in the last few minutes and whose save hasn't been opened from the toast yet.
 */
export function useRecentlySaved(rawProjectsRef: MutableRefObject<any[]>) {
  const [recentlySavedProject, setRecentlySavedProject] = useState<RecentlySavedProject | null>(null);
  const [recentlySavedDismissed, setRecentlySavedDismissed] = useState(false);
  const [handledModTimes, setHandledModTimes] = useState<Map<string, string>>(loadHandledModTimes);

  useEffect(() => {
    setRecentlySavedDismissed(false);
  }, [recentlySavedProject?.id, recentlySavedProject?.latestModTime]);

  // Persist handled mod times
  useEffect(() => {
    localStorage.setItem(HANDLED_MOD_TIMES_KEY, JSON.stringify([...handledModTimes]));
  }, [handledModTimes]);

  const checkRecentlySaved = useCallback(async () => {
    try {
      const allProjects = rawProjectsRef.current;
      if (!allProjects || allProjects.length === 0) return;

      for (const p of allProjects) {
        if (!p.path || p.path === 'NA') continue;
        const result = await window.ipcRenderer.invoke('check-project-modified', p.path, 5);

        if (result.modified && result.latestModTime) {
          const projectId = p.project_id ?? `local:${p.name}`;
          const lastHandled = handledModTimes.get(projectId);
          if (!lastHandled || result.latestModTime > lastHandled) {
            setRecentlySavedProject({
              id: projectId,
              name: p.name,
              path: p.path,
              daw: p.daw,
              latestModTime: result.latestModTime,
            });
            return;
          }
        }
      }
      setRecentlySavedProject(null);
    } catch (err) {
      console.error('Error checking recently saved:', err);
    }
  }, [handledModTimes, rawProjectsRef]);

  // Re-check when the window regains focus (back from the DAW).
  useEffect(() => {
    const handleFocus = () => checkRecentlySaved();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [checkRecentlySaved]);

  /** Remembers the toast's save as handled, so it isn't offered again. */
  const markRecentlySavedHandled = () => {
    const recent = recentlySavedProject;
    if (recent?.latestModTime) {
      setHandledModTimes(prev => new Map(prev).set(recent.id, recent.latestModTime!));
    }
  };

  return {
    recentlySavedProject,
    recentlySavedDismissed,
    dismissRecentlySaved: () => setRecentlySavedDismissed(true),
    checkRecentlySaved,
    markRecentlySavedHandled,
  };
}
