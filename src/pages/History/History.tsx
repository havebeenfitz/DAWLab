/**
 * History.tsx
 *
 * A project's page: its versions (commit graph per alternative), the files,
 * plugins and comments of the active version, and the preview player.
 *
 * State and actions live in ./hooks, presentational pieces in ./components.
 * The heavy logic for graph reconstruction is in utils/commitGraphUtils.ts
 */

import React, { useState, useEffect, useMemo } from "react";
import { notify } from "@/lib/notify";
import { createPortal } from "react-dom";
import { Link, useLocation, useParams, useNavigate } from "react-router-dom";
import type { ProjectLog } from "@/types/project.types";
import { CommitGraph } from "@/components/CommitGraph";
import { PathSelectionModal } from "@/components/PathSelectionModal";
import { MergeModal } from "@/components/MergeModal/MergeModal";
import { ProjectSettings } from "@/components/ProjectSettings/ProjectSettings";
import { useOptionalSharing } from "@/components/Sharing";
import { useProjectAccess } from "@/hooks/useProjectAccess";
import { useSharedProjectSync } from "@/hooks/useSharedProjectSync";
import { ParallelVersionBanner } from "./components/ParallelVersionBanner";
import { openParallelVersions } from "../../../shared/forks";
import FeedbackView from "@/components/Feedback/FeedbackView";
import { BranchMenu } from "@/components/BranchMenu/BranchMenu";
import { TagManagerPopover } from "@/components/TagManagerPopover/TagManagerPopover";
import { useUsername } from "@/hooks/useUsername";
import { HistoryHeader } from "./components/HistoryHeader";
import { VersionTagFilter } from "./components/VersionTagFilter";
import { HistoryBottomPanels, type BottomPanelTab } from "./components/HistoryBottomPanels";
import { PreviewBar } from "./components/PreviewBar";
import { HistoryWarningModals } from "./components/HistoryWarningModals";
import { useProjectLog } from "./hooks/useProjectLog";
import { usePathPrompt } from "./hooks/usePathPrompt";
import { useProjectPath } from "./hooks/useProjectPath";
import { useUnsavedChanges } from "./hooks/useUnsavedChanges";
import { useDraftWatch } from "./hooks/useDraftWatch";
import { useVersionTags } from "./hooks/useVersionTags";
import { usePreviewPlayer } from "./hooks/usePreviewPlayer";
import { useFeedbackSession } from "./hooks/useFeedbackSession";
import { usePreviewUpload } from "./hooks/usePreviewUpload";
import { useStorageWarning } from "./hooks/useStorageWarning";
import { useCommitActions } from "./hooks/useCommitActions";
import { useBranchActions } from "./hooks/useBranchActions";
import "./History.css";

/** The focused commit, falling back to the checked-out one. */
/** Newest version on an alternative, or null. */
function newestOn(projectLog: ProjectLog | null, branch: string): string | null {
  const commits = projectLog?.branches?.find((b) => b.name === branch)?.commits ?? [];
  const newest = [...commits].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).pop();
  return newest ? String(newest.commit_id) : null;
}

function findActiveCommit(projectLog: ProjectLog | null, focusedCommitId: string | null) {
  if (!projectLog?.branches) return null;
  const targetId = focusedCommitId || projectLog.lastCheckout?.commitId;
  if (!targetId) return null;
  for (const branch of projectLog.branches) {
    const commit = branch.commits.find((c) => String(c.commit_id) === String(targetId));
    if (commit) return commit;
  }
  return null;
}

/** 1-based position of `commitId` on `branchName` (commits are oldest first). */
function findVersionNumber(projectLog: ProjectLog | null, branchName: string, commitId: string | undefined) {
  if (!commitId || !projectLog?.branches) return null;
  const branch = projectLog.branches.find((b) => b.name === branchName);
  if (!branch) return null;
  const index = branch.commits.findIndex((c) => String(c.commit_id) === String(commitId));
  return index !== -1 ? index + 1 : null;
}

async function openInDaw(projectPath: string) {
  try {
    const result = await window.ipcRenderer.invoke("open-project", projectPath);
    if (!result.success) {
      notify.error("Couldn't open the project", result.error);
    }
  } catch (error) {
    console.error("Error opening project:", error);
    notify.error("Couldn't open the project", "Check that the project folder still exists, or set its location in Project settings.");
  }
}

export const History: React.FC = () => {
  const { username } = useUsername();
  const location = useLocation();
  const navigate = useNavigate();
  const passedProject = location.state?.projectName;
  const { projectId } = useParams();
  const sharing = useOptionalSharing();
  const access = useProjectAccess(passedProject);

  const log = useProjectLog(passedProject, projectId);
  // Shared projects: new versions from others, and Pull.
  const sharedSync = useSharedProjectSync(passedProject, access.folder?.folderId, log.refreshProjectLog);
  const { projectLog, selectedBranch, loadProjectLog } = log;
  const pathPrompt = usePathPrompt();
  const projectPath = useProjectPath(projectLog, () => pathPrompt.requestPath(null));
  const hasUnsavedChanges = useUnsavedChanges(projectLog, projectPath);
  const tags = useVersionTags({ passedProject, projectLog, setProjectLog: log.setProjectLog, selectedBranch });

  /** Currently focused commit for preview/actions (independent of checkout) */
  const [focusedCommitId, setFocusedCommitId] = useState<string | null>(null);
  /** Mobile tab state for Files/Plugins/Comments toggle */
  const [activeMobileTab, setActiveMobileTab] = useState<BottomPanelTab>("files");
  /** Alternatives menu open/close state */
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  /** Controls whether the merge modal is visible */
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(location.state?.openSettings === true);

  const activeCommit = useMemo(() => findActiveCommit(projectLog, focusedCommitId), [projectLog, focusedCommitId]);
  const versionNumber = useMemo(
    () => findVersionNumber(projectLog, selectedBranch, activeCommit?.commit_id),
    [activeCommit, projectLog, selectedBranch],
  );

  const player = usePreviewPlayer(activeCommit, passedProject);
  const feedback = useFeedbackSession(player, activeCommit, tags.branchCommits);
  const upload = usePreviewUpload(activeCommit, passedProject, log.refreshProjectLog);
  const storage = useStorageWarning();
  const commits = useCommitActions({
    passedProject, projectLog, projectPath, selectedBranch, username, hasUnsavedChanges,
    loadProjectLog, requestPath: pathPrompt.requestPath, storage,
  });
  const branches = useBranchActions({
    passedProject, projectId, projectLog, projectPath, username, loadProjectLog,
    setProjectLog: log.setProjectLog, setSelectedBranch: log.setSelectedBranch,
    invalidatePendingLoads: log.invalidatePendingLoads, requestPath: pathPrompt.requestPath,
    closeBranchMenu: () => setIsDropdownOpen(false), setFocusedCommitId,
  });
  useDraftWatch({ passedProject, projectPath, selectedBranch, username, isListener: access.isListener });

  // Cmd+K (or Ctrl+K) opens the alternatives menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (feedback.feedbackOpenRef.current) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsDropdownOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [feedback.feedbackOpenRef]);

  // Back navigation: from project settings, step back to the project view;
  // otherwise return to the library (which restores the folder you came from).
  const handleBack = () => {
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    navigate("/");
  };

  const handleOpenInDaw = async () => {
    if (!projectLog) return;
    if (!projectPath || projectPath === "/") {
      pathPrompt.requestPath({ type: "checkout" });
      return;
    }
    await openInDaw(projectPath);
  };

  /** Saves the chosen location, then continues whatever was waiting on it. */
  const handleConfirmPath = async (path: string, setLoading: (loading: boolean) => void) => {
    const { pendingAction } = pathPrompt;
    try {
      // The unified update-project-path handler covers both owned and shared projects
      await window.ipcRenderer.invoke("update-project-path", projectId || passedProject, path + "/" + passedProject);
      await loadProjectLog(passedProject);

      if (pendingAction?.type === "checkout") {
        await window.ipcRenderer.invoke("rollback-project", passedProject, pendingAction.commitId);
      }
      if (pendingAction?.type === "commit") {
        await commits.resumeCommitAfterPath();
      }
      if (pendingAction?.type === "branch" && !(await branches.resumeBranchAfterPath())) {
        return;
      }
      pathPrompt.closePathModal();
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (fromBranch: string, toBranch: string) => {
    try {
      await window.ipcRenderer.invoke(
        "merge-branches",
        passedProject,
        projectId || "",
        fromBranch,
        toBranch,
        username || "unknown",
      );
      setIsMerging(false);
    } catch (error) {
      console.error("Merge failed:", error);
    }
  };

  if (!projectLog) {
    return (
      <div className="history-page history-loading-container">
        <div className="history-loading-content">
          <div className="history-loading-spinner" />
          <div className="history-loading-text">Loading project...</div>
        </div>
      </div>
    );
  }

  if (!projectLog.branches) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-gray-400">
        <div className="text-xl mb-4">Oops, this project doesn't exist</div>
        <Link
          to="/"
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Go back to Library
        </Link>
      </div>
    );
  }

  const { visibleCommits, versionTagPopover } = tags;

  return (
    <div className="history-page px-6 pt-2 pb-6">
      <HistoryHeader
        projectName={passedProject || ""}
        alternative={selectedBranch || "main"}
        daw={projectLog.daw ?? undefined}
        isSyncing={log.isSyncing}
        showSettings={showSettings}
        access={access}
        syncStatus={access.folder ? sharing?.status[access.folder.folderId] : undefined}
        onBack={handleBack}
        onToggleAlternatives={() => setIsDropdownOpen(!isDropdownOpen)}
        alternativesMenu={isDropdownOpen && (
          <BranchMenu
            branches={projectLog.branches}
            selectedBranch={selectedBranch}
            onSwitchBranch={branches.handleSwitchBranch}
            onCreateBranch={(name) => {
              commits.setIsCreatingCommit(false);
              branches.handleCreateBranch(name);
            }}
            onClose={() => setIsDropdownOpen(false)}
            error={branches.branchError}
            isCreating={branches.isCreatingBranch}
          />
        )}
        onSave={commits.handleSaveButtonClick}
        onOpenInDaw={handleOpenInDaw}
        onShare={() => passedProject && sharing?.shareProject(passedProject)}
        onToggleSettings={() => setShowSettings(!showSettings)}
        sync={access.folder ? { incoming: sharedSync.incoming, pulling: sharedSync.pulling, pull: () => { void sharedSync.pull(); } } : undefined}
      />

      {!showSettings && (
        <ParallelVersionBanner
          projectName={passedProject || ""}
          versions={openParallelVersions(projectLog, selectedBranch || "main")}
          currentTipId={newestOn(projectLog, selectedBranch || "main")}
          username={username || "You"}
          onChanged={log.refreshProjectLog}
        />
      )}

      {showSettings ? (
        <ProjectSettings
          projectId={projectId || ""}
          projectName={passedProject || "Project"}
          onBack={() => setShowSettings(false)}
        />
      ) : (
        <>
          <VersionTagFilter
            tags={tags.branchVersionTags}
            tagColors={tags.tagColors}
            activeTags={tags.activeVersionTags}
            onToggle={tags.toggleVersionTagFilter}
            effectiveFilterCount={tags.effectiveVersionFilter.length}
            visibleCount={visibleCommits.length}
            totalCount={tags.branchCommits.length}
          />

          {visibleCommits.length > 0 ? (
            <CommitGraph
              commits={visibleCommits}
              tagColors={tags.tagColors}
              onEditTags={(commitId, x, y) => tags.setVersionTagPopover({ commitId, x, y })}
              onCheckout={commits.handleCheckout}
              onDeleteCommit={commits.handleDeleteCommitRequest}
              onBranchCreate={branches.handleBranchFromCommit}
              currentCommitId={projectLog.lastCheckout?.commitId}
              selectedCommitId={focusedCommitId}
              onCommitSelect={setFocusedCommitId}
              lastCheckoutTimestamp={projectLog.lastCheckout?.timestamp}
              hasUnsavedChanges={hasUnsavedChanges}
              restoringCommitId={commits.restoringCommitId}
              projectName={passedProject}
              projectId={projectId || ""}
              currentBranch={selectedBranch}
              onSaveCommit={commits.handleSaveCommit}
              onCancelSave={commits.cancelCommitForm}
              isCommitting={commits.isCommitting}
              isCreatingCommit={commits.isCreatingCommit}
              readOnly={access.isListener}
            />
          ) : (
            <div className="text-white text-center py-10">
              {branches.isCreatingBranch
                ? "Loading branch..."
                : "No versions in this branch"}
            </div>
          )}
        </>
      )}

      {/* Bottom panels and the preview dropzone are hidden in the settings view */}
      {!showSettings && (
        <HistoryBottomPanels
          activeTab={activeMobileTab}
          onTabChange={setActiveMobileTab}
          projectName={passedProject}
          fileCommitId={activeCommit?.commit_id || projectLog.lastCheckout?.commitId}
          projectPath={projectPath}
          onSelectPath={pathPrompt.openPathModal}
          plugins={(projectLog as any).metadata?.plugins || []}
          commentsCommitId={activeCommit ? String(activeCommit.commit_id) : null}
          commentsKey={`${activeCommit?.commit_id ?? "none"}-${feedback.feedbackSession ? "fs" : "docked"}`}
          username={username || "You"}
          currentTime={player.currentTime}
          onPlayFrom={player.playFrom}
        />
      )}

      {!showSettings && (
        <PreviewBar
          activeCommit={activeCommit}
          versionNumber={versionNumber}
          player={player}
          upload={upload}
          onOpenFeedback={feedback.handleOpenFeedback}
        />
      )}

      {/* Full-screen feedback over everything, including the app chrome */}
      {feedback.feedbackSession && feedback.feedbackVersion &&
        createPortal(
          <FeedbackView
            key={feedback.feedbackVersion.commitId}
            projectName={passedProject}
            version={feedback.feedbackVersion}
            versions={feedback.feedbackVersions}
            username={username || "You"}
            getStartTime={feedback.getFeedbackStartTime}
            autoPlay={feedback.feedbackSession.autoPlay}
            onTakeover={feedback.handleFeedbackTakeover}
            onClose={feedback.handleCloseFeedback}
          />,
          document.body,
        )}

      {/* Version tag editor */}
      {versionTagPopover && (
        <TagManagerPopover
          title="Version Tags"
          x={versionTagPopover.x}
          y={versionTagPopover.y}
          tags={tags.findCommitTags(versionTagPopover.commitId)}
          tagColors={tags.tagColors}
          suggestions={tags.versionTagSuggestions}
          onAddTag={(tag, color) => tags.handleAddVersionTag(versionTagPopover.commitId, tag, color)}
          onRemoveTag={(tag) => tags.handleRemoveVersionTag(versionTagPopover.commitId, tag)}
          onClose={() => tags.setVersionTagPopover(null)}
        />
      )}

      <PathSelectionModal
        isOpen={pathPrompt.showPathModal}
        onClose={pathPrompt.closePathModal}
        onConfirm={handleConfirmPath}
      />
      <MergeModal
        isOpen={isMerging}
        onClose={() => setIsMerging(false)}
        onSubmit={handleMerge}
        projectName={passedProject}
        projectId={projectId || ""}
      />
      <HistoryWarningModals
        commits={commits}
        storage={storage}
        onManageSettings={() => navigate("/settings")}
      />
    </div>
  );
};
