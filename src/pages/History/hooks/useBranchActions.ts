import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { notify } from "@/lib/notify";
import type { ProjectLog } from "@/types/project.types";
import type { PendingPathAction } from "./usePathPrompt";

interface BranchActionsOptions {
  passedProject: string;
  projectId: string | undefined;
  projectLog: ProjectLog | null;
  projectPath: string | null;
  username: string | null | undefined;
  loadProjectLog: (projectName: string) => Promise<void>;
  setProjectLog: Dispatch<SetStateAction<ProjectLog | null>>;
  setSelectedBranch: (branch: string) => void;
  invalidatePendingLoads: () => void;
  requestPath: (action: PendingPathAction | null) => void;
  closeBranchMenu: () => void;
  setFocusedCommitId: (commitId: string | null) => void;
}

/** Creating and switching alternatives (branches). */
export function useBranchActions(o: BranchActionsOptions) {
  const { passedProject, projectLog, projectPath } = o;
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchError, setBranchError] = useState<string | null>(null);

  /** Creates a branch from the current files and switches to it. */
  const createAndSwitch = async (branchName: string) => {
    const createResult = await window.ipcRenderer.invoke(
      "create-branch",
      passedProject,
      branchName,
      undefined,
      o.username || "",
    );
    if (!createResult.success) {
      console.error("Failed to create branch:", createResult);
      return false;
    }
    await window.ipcRenderer.invoke("switch-branch", passedProject, branchName);
    await o.loadProjectLog(passedProject);
    o.setSelectedBranch(branchName);
    setNewBranchName("");
    o.closeBranchMenu();
    return true;
  };

  const handleCreateBranch = async (name?: string) => {
    const branchToCreate = name || newBranchName;
    if (!passedProject || !branchToCreate.trim()) {
      console.warn("No project selected or branch name is empty");
      return;
    }
    if (!projectLog) return;

    if (!projectPath || projectPath === "/") {
      o.requestPath({ type: "branch" });
      return;
    }

    try {
      setIsCreatingBranch(true);
      setBranchError(null);
      if (!(await createAndSwitch(branchToCreate.trim()))) {
        setBranchError("Failed to create branch");
        return;
      }
      o.setFocusedCommitId(null); // Reset focus on branch switch
    } catch (err: any) {
      console.error("Branch creation error:", err);
      setBranchError(err?.message || "Failed to create branch");
    } finally {
      setIsCreatingBranch(false);
    }
  };

  /**
   * Resumes a branch creation that was waiting on the path prompt.
   * Returns false when creation failed and the path prompt should stay open.
   */
  const resumeBranchAfterPath = async (): Promise<boolean> => {
    if (!newBranchName.trim() || !projectLog) return true;
    try {
      setIsCreatingBranch(true);
      if (!(await createAndSwitch(newBranchName.trim()))) {
        notify.error("Couldn't create the alternative");
        return false;
      }
    } catch (err) {
      console.error("Branch creation error:", err);
    } finally {
      setIsCreatingBranch(false);
    }
    return true;
  };

  const handleSwitchBranch = async (branchName: string) => {
    if (!passedProject) {
      console.warn("No project selected");
      return;
    }

    try {
      // Cancel any pending background log refreshes
      o.invalidatePendingLoads();

      // Optimistic UI: Close immediately and update local state
      o.closeBranchMenu();
      o.setSelectedBranch(branchName);
      o.setFocusedCommitId(null);

      const result = await window.ipcRenderer.invoke("switch-branch", passedProject, branchName, o.projectId);
      if (result.success && result.log) {
        o.setProjectLog(result.log);
      }

      // Background log refresh (UI is already updated optimistically)
      o.loadProjectLog(passedProject);
    } catch (err) {
      console.error("Branch switch error:", err);
    }
  };

  /** Creates a branch from a specific commit (context menu action); throws for CommitGraph. */
  const handleBranchFromCommit = async (branchName: string, fromCommitId: string) => {
    if (!passedProject || !projectLog) {
      console.error("[History] Cannot create branch: missing project or log");
      throw new Error("Project information not available");
    }
    if (!projectPath || projectPath === "/") {
      throw new Error("Please set a project path first");
    }

    try {
      const result = await window.ipcRenderer.invoke(
        "create-branch",
        passedProject,
        branchName,
        fromCommitId, // creates the branch from this commit
        o.username || "",
      );
      if (!result.success) {
        console.error("[History] Branch creation failed:", result);
        throw new Error(result.error || "Failed to create branch");
      }

      await o.loadProjectLog(passedProject);
      o.setSelectedBranch(branchName);
    } catch (err: any) {
      console.error("[History] Error creating branch from commit:", err);
      throw err; // Re-throw so CommitGraph can handle the error
    }
  };

  return {
    isCreatingBranch,
    branchError,
    handleCreateBranch,
    resumeBranchAfterPath,
    handleSwitchBranch,
    handleBranchFromCommit,
  };
}
