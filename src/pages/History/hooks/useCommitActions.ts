import { useState } from "react";
import { notify } from "@/lib/notify";
import type { ProjectLog } from "@/types/project.types";
import { shouldSkipWarning } from "@/components/WarningModal/WarningModal";
import { detectChangesSinceCheckout } from "../utils/checkoutTime";
import type { PendingPathAction } from "./usePathPrompt";
import { STORAGE_LIMIT_MESSAGE, type useStorageWarning } from "./useStorageWarning";

type StorageWarning = ReturnType<typeof useStorageWarning>;

interface CommitActionsOptions {
  passedProject: string;
  projectLog: ProjectLog | null;
  projectPath: string | null;
  selectedBranch: string;
  username: string | null | undefined;
  hasUnsavedChanges: boolean;
  loadProjectLog: (projectName: string) => Promise<void>;
  requestPath: (action: PendingPathAction | null) => void;
  storage: StorageWarning;
}

const errorText = (error: any): string => error?.message || String(error);

/** Saving a new version, restoring an older one and deleting versions. */
export function useCommitActions(o: CommitActionsOptions) {
  const { passedProject, projectLog, projectPath, storage } = o;

  /** Controls whether the commit form is visible */
  const [isCreatingCommit, setIsCreatingCommit] = useState<boolean>(false);
  /** Commit message being typed */
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);

  // Which commit is currently being restored (for the spinning animation)
  const [restoringCommitId, setRestoringCommitId] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingCheckoutId, setPendingCheckoutId] = useState<string | null>(null);

  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [pendingDeleteCommitId, setPendingDeleteCommitId] = useState<string | null>(null);
  const [isDeletingCommit, setIsDeletingCommit] = useState(false);

  // ---------------------------------------------------------------------------
  // Save a version
  // ---------------------------------------------------------------------------

  /** Creates the commit. The single place that calls "commit-project". */
  const performCommit = async (messageOverride?: string) => {
    if (!projectLog) return;

    setIsCommitting(true);
    try {
      await window.ipcRenderer.invoke(
        "commit-project",
        passedProject,
        messageOverride || commitMessage,
        o.selectedBranch,
        o.username || "",
      );

      // Reset form
      setCommitMessage("");
      setIsCreatingCommit(false);

      // Reload the project log to show the new commit
      await o.loadProjectLog(passedProject);

      // "Save first" before a Restore: the work is saved, now do the Restore that was asked for.
      if (pendingCheckoutId) {
        const commitId = pendingCheckoutId;
        setPendingCheckoutId(null);
        await performCheckout(commitId);
      }
    } catch (error: any) {
      console.error("Error creating commit:", error);
      const errorMessage = errorText(error);
      if (errorMessage.includes("Storage limit exceeded") || errorMessage.includes("403")) {
        storage.showStorageLimit(STORAGE_LIMIT_MESSAGE);
      } else {
        notify.error("Couldn't save the version", errorMessage);
      }
    } finally {
      setIsCommitting(false);
    }
  };

  /** Saves a new commit with the message from the Save card. */
  const handleSaveCommit = async (customMessage?: string) => {
    const messageToUse = customMessage || commitMessage;
    if (!messageToUse.trim()) {
      notify.info("Add a short note", "Describe what changed in this version, then save.");
      return;
    }

    if (!projectLog) return;
    if (!projectPath || projectPath === "/") {
      o.requestPath({ type: "commit" });
      return;
    }

    await performCommit(messageToUse);
  };

  /** Resumes a save that was waiting on the path prompt (only if a message was typed). */
  const resumeCommitAfterPath = async () => {
    if (commitMessage.trim()) {
      await performCommit(commitMessage);
    }
  };

  /** Save button in the header: warns if nothing changed, otherwise opens the commit form. */
  const handleSaveButtonClick = async () => {
    if (!projectPath || projectPath === "/" || projectPath === "NA") {
      o.requestPath({ type: "commit" });
      return;
    }

    const skipDuplicateWarning = await shouldSkipWarning("duplicate-commit");
    if (!o.hasUnsavedChanges && !skipDuplicateWarning) {
      setShowDuplicateWarning(true);
      return;
    }
    setIsCreatingCommit(true);
  };

  const handleDuplicateCommitAnyway = () => {
    setShowDuplicateWarning(false);
    setIsCreatingCommit(true);
  };

  const handleCancelDuplicateCommit = () => {
    setShowDuplicateWarning(false);
  };

  const cancelCommitForm = () => {
    setIsCreatingCommit(false);
    setCommitMessage("");
  };

  // ---------------------------------------------------------------------------
  // Restore a version
  // ---------------------------------------------------------------------------

  /** Performs the actual rollback to a commit */
  const performCheckout = async (commitId: string, bypassLimit = false) => {
    if (!projectLog) return;
    setRestoringCommitId(commitId);

    try {
      const result = await window.ipcRenderer.invoke("rollback-project", passedProject, commitId, bypassLimit);
      // Reload project log to get updated lastCheckout
      await o.loadProjectLog(passedProject);
      const note = describeRestore(result);
      if (note) notify.info(note.title, note.detail);
    } catch (error: any) {
      console.error("Error during rollback:", error);
      const errorMessage = errorText(error);
      if (errorMessage.includes("Storage limit exceeded")) {
        storage.showStorageLimit(STORAGE_LIMIT_MESSAGE, commitId);
      } else {
        notify.error("Couldn't restore this version", errorMessage);
      }
    } finally {
      setRestoringCommitId(null);
    }
  };

  /**
   * Shows the unsaved-changes warning for `commitId` if the project's files
   * changed since the last checkout. Returns true when the warning was shown.
   */
  const warnIfUnsaved = async (commitId: string, logTag: string): Promise<boolean> => {
    if (await shouldSkipWarning("unsaved-changes")) return false;
    try {
      const lastCheckout = projectLog?.lastCheckout;
      if (lastCheckout && (await detectChangesSinceCheckout(projectPath, lastCheckout.timestamp)) === true) {
        setPendingCheckoutId(commitId);
        setShowUnsavedWarning(true);
        return true;
      }
    } catch (error) {
      // Continue with checkout if we can't check
      console.warn(`[${logTag}] Error checking for unsaved changes:`, error);
    }
    return false;
  };

  /** Restores a version, checking for a project path and unsaved changes first. */
  const handleCheckout = async (commitId: string) => {
    if (!projectLog) return;

    if (!projectPath || projectPath === "NA") {
      o.requestPath({ type: "checkout", commitId });
      return;
    }

    if (await warnIfUnsaved(commitId, "handleCheckout")) return;
    await performCheckout(commitId);
  };

  /** Restore despite unsaved changes */
  const handleProceedAnyway = async () => {
    setShowUnsavedWarning(false);
    if (pendingCheckoutId) {
      await performCheckout(pendingCheckoutId);
      setPendingCheckoutId(null);
    }
  };

  /** Save first: open the commit form; pendingCheckoutId is kept for afterwards. */
  const handleCommitFirst = () => {
    setShowUnsavedWarning(false);
    setIsCreatingCommit(true);
  };

  const handleCancelCheckout = () => {
    setShowUnsavedWarning(false);
    setPendingCheckoutId(null);
  };

  /** Restore that was blocked by the storage limit, bypassing the limit. */
  const handleProceedCheckoutAnyway = async () => {
    storage.hideStorageWarning();
    const commitId = storage.takePendingCheckout();
    if (!commitId) return;
    if (await warnIfUnsaved(commitId, "handleProceedCheckoutAnyway")) return;
    await performCheckout(commitId, true);
  };

  // ---------------------------------------------------------------------------
  // Delete a version
  // ---------------------------------------------------------------------------

  const handleDeleteCommitRequest = (commitId: string) => {
    setPendingDeleteCommitId(commitId);
    setShowDeleteConfirmation(true);
  };

  /** Deletes the version (the pending one unless an id is passed). */
  const handleConfirmDeleteCommit = async (commitIdOverride?: string) => {
    const commitId = commitIdOverride || pendingDeleteCommitId;
    if (!commitId || !passedProject || !projectLog) return;

    setIsDeletingCommit(true);
    try {
      const result = await window.ipcRenderer.invoke("delete-commit", commitId, passedProject);
      if (result.success) {
        await o.loadProjectLog(passedProject);
      } else {
        notify.error("Couldn't delete the version", result.error);
      }
    } catch (error: any) {
      console.error("[handleConfirmDeleteCommit] Error:", error);
      notify.error("Couldn't delete the version", error);
    } finally {
      setIsDeletingCommit(false);
      setShowDeleteConfirmation(false);
      setPendingDeleteCommitId(null);
    }
  };

  const handleCancelDeleteCommit = () => {
    setShowDeleteConfirmation(false);
    setPendingDeleteCommitId(null);
  };

  return {
    isCreatingCommit,
    setIsCreatingCommit,
    isCommitting,
    showDuplicateWarning,
    restoringCommitId,
    showUnsavedWarning,
    showDeleteConfirmation,
    isDeletingCommit,
    handleSaveCommit,
    resumeCommitAfterPath,
    handleSaveButtonClick,
    handleDuplicateCommitAnyway,
    handleCancelDuplicateCommit,
    cancelCommitForm,
    handleCheckout,
    handleProceedAnyway,
    handleCommitFirst,
    handleCancelCheckout,
    handleProceedCheckoutAnyway,
    handleDeleteCommitRequest,
    handleConfirmDeleteCommit,
    handleCancelDeleteCommit,
  };
}

/** What a Restore did beyond putting the version in place: kept unsaved work, moved extra files to the Trash. */
export function describeRestore(r: { keptAs?: { message: string } | null; removed?: number; trashedAs?: string | null } | null | undefined): { title: string; detail: string } | null {
  if (!r) return null
  const removed = r.removed ?? 0
  const files = `${removed} extra file${removed === 1 ? '' : 's'}`
  if (r.keptAs && removed > 0) {
    return { title: 'Restored, and your work is kept', detail: `${files} ${removed === 1 ? 'was' : 'were'} moved to the Trash and kept in “${r.keptAs.message}”. Bring back restores them.` }
  }
  if (r.keptAs) return { title: 'Restored, and your work is kept', detail: `Your unsaved work is in “${r.keptAs.message}”. Bring back restores it.` }
  if (removed > 0) return { title: 'Restored', detail: `${files} not in this version ${removed === 1 ? 'was' : 'were'} moved to the Trash${r.trashedAs ? `, in “${r.trashedAs}”` : ''}.` }
  return null
}

