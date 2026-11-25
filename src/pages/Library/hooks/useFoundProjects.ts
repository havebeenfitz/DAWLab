import { useCallback, useEffect, useState } from 'react';
import type { FoundProject } from '@/components/FoundProjects';

// Runs the watched-folder scan for new projects at most once per app session, so
// navigating away from the Library and back doesn't re-walk the disk each time.
// The Settings "Scan now" button bypasses this via a sessionStorage handoff.
let ranAutoScanThisSession = false;

// sessionStorage key the Settings "Scan now" button uses to hand fresh scan
// results to the Library so its banner shows them immediately on navigation.
const FOUND_PROJECTS_HANDOFF_KEY = 'dawlab-found-projects-handoff';

/** Newly-detected projects in watched folders that aren't imported yet. */
export function useFoundProjects() {
  const [foundProjects, setFoundProjects] = useState<FoundProject[]>([]);
  const [showFoundPanel, setShowFoundPanel] = useState(false);
  const [foundDismissed, setFoundDismissed] = useState(false);

  // Close the review panel once every found project has been added or ignored.
  useEffect(() => {
    if (foundProjects.length === 0) setShowFoundPanel(false);
  }, [foundProjects.length]);

  // Surface projects created in watched folders since the last check. Prefers
  // results handed over by the Settings "Scan now" button; otherwise runs the
  // background scan once per session. Never blocks the Library render.
  const detectNewProjects = useCallback(() => {
    const handoff = sessionStorage.getItem(FOUND_PROJECTS_HANDOFF_KEY);
    if (handoff) {
      sessionStorage.removeItem(FOUND_PROJECTS_HANDOFF_KEY);
      ranAutoScanThisSession = true;
      try {
        const parsed: FoundProject[] = JSON.parse(handoff);
        setFoundProjects(parsed);
        setFoundDismissed(false);
      } catch {
        /* malformed handoff — ignore */
      }
      return;
    }
    if (ranAutoScanThisSession) return;
    ranAutoScanThisSession = true;
    window.ipcRenderer
      .invoke('scan-watched-for-new-projects')
      .then((res: FoundProject[]) => setFoundProjects(res || []))
      .catch(() => {});
  }, []);

  // Remove one found project from the banner/panel (after Add or Ignore).
  const removeFoundProject = useCallback((projectPath: string) => {
    setFoundProjects((prev) => prev.filter((p) => p.path !== projectPath));
  }, []);

  return {
    foundProjects,
    showFoundPanel,
    setShowFoundPanel,
    foundDismissed,
    setFoundDismissed,
    detectNewProjects,
    removeFoundProject,
  };
}
