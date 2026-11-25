import { useEffect, useState } from "react";
import type { ProjectLog } from "@/types/project.types";

/**
 * Fetches the project's folder from the registry (the single source of truth
 * for project paths) whenever the log changes. Calls `onPathMissing` when the
 * project has no usable location yet so the caller can prompt for one.
 */
export function useProjectPath(projectLog: ProjectLog | null, onPathMissing: () => void) {
  const [projectPath, setProjectPath] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjectPath = async () => {
      if (!projectLog || Object.keys(projectLog).length === 0) {
        setProjectPath(null);
        return;
      }

      try {
        const path = await window.ipcRenderer.invoke("get-project-path", projectLog.name, projectLog.id);
        setProjectPath(path);

        // Auto-prompt path selection if it's missing
        if (!path || path === "NA" || path === "/") {
          onPathMissing();
        }
      } catch (error) {
        console.error("[History] Error fetching project path:", error);
        setProjectPath(null);
      }
    };

    fetchProjectPath();
    // onPathMissing only opens the path prompt; re-running on its identity would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectLog]);

  return projectPath;
}
