import { useEffect, useState } from "react";
import type { ProjectLog } from "@/types/project.types";
import { detectChangesSinceCheckout } from "../utils/checkoutTime";

/**
 * Whether the project's files were modified since the last checkout (drives
 * the status icons). Re-checked whenever the log or the project path changes.
 */
export function useUnsavedChanges(projectLog: ProjectLog | null, projectPath: string | null) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    const checkForUnsavedChanges = async () => {
      // No valid path: the project hasn't been downloaded locally yet.
      // No lastCheckout: nothing to compare against (shows the blue state).
      if (projectPath === "NA" || !projectPath || projectPath === "/" || !projectLog?.lastCheckout) {
        setHasUnsavedChanges(false);
        return;
      }

      try {
        const changed = await detectChangesSinceCheckout(projectPath, projectLog.lastCheckout.timestamp);
        setHasUnsavedChanges(changed === true);
      } catch (error) {
        console.warn("[hasUnsavedChanges] Error checking for unsaved changes:", error);
        setHasUnsavedChanges(false);
      }
    };

    checkForUnsavedChanges();
  }, [projectLog, projectPath]);

  return hasUnsavedChanges;
}
