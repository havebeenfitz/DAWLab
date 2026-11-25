import { useEffect, useRef, useState } from "react";
import type { ProjectLog } from "@/types/project.types";

/**
 * Loads and refreshes the version-control log of the open project.
 * A request counter drops responses that arrive after a newer request.
 */
export function useProjectLog(passedProject: string | undefined, projectId: string | undefined) {
  /** Version control log for the selected project (contains all branches and commits) */
  const [projectLog, setProjectLog] = useState<ProjectLog | null>(null);
  /** Currently selected branch (for highlighting in the graph) */
  const [selectedBranch, setSelectedBranch] = useState<string>("main");
  const [isSyncing, setIsSyncing] = useState(false);
  /** Track the latest request ID to prevent stale-response race conditions */
  const lastLogRequestIdRef = useRef<number>(0);

  /**
   * When a project is selected: load its version control log from disk.
   * Falls back to registry-based lookup if no local log file is found yet
   * (e.g. right after init, before the log file has been written).
   */
  useEffect(() => {
    if (!passedProject) return;

    const loadAndSync = async () => {
      const requestId = ++lastLogRequestIdRef.current;

      const localLog = await window.ipcRenderer.invoke("get-local-project-log", passedProject, projectId);

      if (requestId === lastLogRequestIdRef.current && localLog) {
        setProjectLog(localLog);
        setSelectedBranch(localLog.current_branch || "main");
        return;
      }

      if (!localLog) {
        setIsSyncing(true);
        const log = await window.ipcRenderer.invoke("get-project-log", passedProject, projectId);
        setIsSyncing(false);

        if (requestId === lastLogRequestIdRef.current && log) {
          setProjectLog(log);
          setSelectedBranch(log.current_branch || "main");
        }
      }
    };

    loadAndSync();
  }, [passedProject, projectId]);

  /**
   * Re-check for unsaved changes when window gains focus (the user returning
   * from their DAW) by handing dependants a fresh projectLog reference.
   */
  useEffect(() => {
    const handleWindowFocus = () => {
      if (projectLog) {
        setProjectLog({ ...projectLog });
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [projectLog]);

  /** Reloads the project log (for use after commits, etc.) */
  const loadProjectLog = async (projectName: string) => {
    const requestId = ++lastLogRequestIdRef.current;

    try {
      const isLocalId = !projectId || projectId.startsWith("local:");

      setIsSyncing(true);
      const log = await window.ipcRenderer.invoke("get-project-log", projectName, isLocalId ? undefined : projectId);

      // Only apply update if this is still the most recent request
      if (requestId === lastLogRequestIdRef.current) {
        setProjectLog(log);
        setSelectedBranch(log.current_branch || "main");
      } else {
        console.warn(`[History] Ignoring stale log data for ${projectName} (newer request exists)`);
      }
    } catch (error) {
      if (requestId === lastLogRequestIdRef.current) {
        console.error("Error loading project log:", error);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  /** Re-reads the local log without touching the selected branch. */
  const refreshProjectLog = async () => {
    if (!passedProject) return;
    const log = await window.ipcRenderer.invoke("get-local-project-log", passedProject, projectId);
    if (log) {
      setProjectLog(log);
    }
  };

  /** Makes any in-flight log load stale so its response is ignored. */
  const invalidatePendingLoads = () => {
    lastLogRequestIdRef.current++;
  };

  return {
    projectLog,
    setProjectLog,
    selectedBranch,
    setSelectedBranch,
    isSyncing,
    loadProjectLog,
    refreshProjectLog,
    invalidatePendingLoads,
  };
}
