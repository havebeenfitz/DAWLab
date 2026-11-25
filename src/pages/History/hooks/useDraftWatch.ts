import { useEffect } from "react";

interface DraftWatchOptions {
  passedProject: string | undefined;
  projectPath: string | null;
  selectedBranch: string;
  username: string | null | undefined;
  isListener: boolean;
}

/**
 * Auto-draft watching: while this project is open, the main process watches
 * its folder and snapshots unsaved DAW saves into an unnamed draft (kept out
 * of history until the user names it). Restarts on branch change so drafts are
 * captured against the branch the user is on.
 */
export function useDraftWatch({ passedProject, projectPath, selectedBranch, username, isListener }: DraftWatchOptions) {
  useEffect(() => {
    // Listeners have no project files here, so there is nothing to snapshot.
    if (isListener || !passedProject || !projectPath || projectPath === "/" || projectPath === "NA") {
      return;
    }

    window.ipcRenderer
      .invoke("start-draft-watch", passedProject, projectPath, selectedBranch || "main", username || "")
      .catch((err) => console.warn("[History] Failed to start draft watch:", err));

    return () => {
      window.ipcRenderer
        .invoke("stop-draft-watch", passedProject)
        .catch((err) => console.warn("[History] Failed to stop draft watch:", err));
    };
  }, [passedProject, projectPath, selectedBranch, username, isListener]);
}
