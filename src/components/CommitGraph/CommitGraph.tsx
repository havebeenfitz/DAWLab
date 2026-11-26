/**
 * CommitGraph.tsx - Updated Component with Box Selection
 *
 * Box highlights selected commit (default: first commit)
 * Double-click icon to open project
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { notify } from "@/lib/notify";
import "./CommitGraph.css";
import { VersionRail } from "./VersionRail";
import { railMessage, type RailFork } from "./rail";
import { Check, RotateCcw, MoreHorizontal } from "lucide-react";
import { ContextMenu, createCommitMenuItems } from "@/components/ContextMenu";
import { InputModal } from "@/components/InputModal";
import { useClickOutside } from "@/hooks/useClickOutside";
import { TagChip } from "@/components/ui/TagChip";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CommitData {
  commit_id: string;
  timestamp: string;
  message: string;
  author: string;
  preview_file?: string;
  tags?: string[];
  /** Unsaved work DAWLab kept before a switch. */
  auto?: boolean;
}

export interface CommitGraphProps {
  commits: CommitData[];
  onCheckout: (commitId: string) => void;
  onDeleteCommit?: (commitId: string) => void;
  onBranchCreate?: (branchName: string, fromCommitId: string) => Promise<void>;
  currentCommitId?: string;
  lastCheckoutTimestamp?: string; // Added to identify newer remote commits
  hasUnsavedChanges?: boolean;
  restoringCommitId?: string | null;
  projectName: string;
  projectId?: string;
  currentBranch: string;
  onSaveCommit?: (message: string) => void; // Added for the "Save" card
  onCancelSave?: () => void;
  isCommitting?: boolean;
  isCreatingCommit?: boolean;
  /** Files that differ from the last saved version; with any, the Save tile shows them and offers Discard. */
  unsavedCount?: number;
  /** What the unsaved changes are, in words (Logic projects): shown under the title. */
  unsavedSummary?: string[];
  /** The unsaved changes are what the right side shows (instead of a version). */
  unsavedSelected?: boolean;
  /** Clicking the unsaved changes card shows them on the right. */
  onSelectUnsaved?: () => void;
  /** The version the unsaved changes are compared with. */
  unsavedBaseMessage?: string | null;
  /** Opens the Discard dialog. */
  onDiscard?: () => void;
  selectedCommitId?: string | null;
  onCommitSelect?: (commitId: string) => void;
  /** Saved tag colors, shared with project tags. */
  tagColors?: Record<string, string>;
  /** Open the version-tag editor for a commit, anchored at a screen point. */
  onEditTags?: (commitId: string, x: number, y: number) => void;
  /** Listeners: versions can be played and previewed, never restored, changed or branched from. */
  readOnly?: boolean;
  /** Parallel versions split from this alternative, folded into the rail where they split. */
  forks?: RailFork[];
  /** You: other people's names show next to their versions, yours don't. */
  me?: string | null;
  onPreviewFork?: (branch: string) => void;
  onDismissFork?: (branch: string) => void;
  forkMenu?: (fork: RailFork) => Array<{ label: string; onClick: () => void; disabled?: boolean }>;
}

// ============================================================================
// COMMIT STATUS TYPES
// ============================================================================

type CommitStatus = "current" | "modified" | "sync" | "restorable";

const getCommitStatus = (
  commit: CommitData,
  currentCommitId: string | undefined,
  lastCheckoutTimestamp: string | undefined,
  hasUnsavedChanges: boolean,
): CommitStatus => {
  const isCurrentOnDevice =
    String(commit.commit_id) === String(currentCommitId);

  if (isCurrentOnDevice) {
    return hasUnsavedChanges ? "modified" : "current";
  }

  // If this commit is newer than the last checkout, it's a sync candidate
  if (lastCheckoutTimestamp && commit.timestamp > lastCheckoutTimestamp) {
    return "sync";
  }

  return "restorable";
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatTimestamp = (timestamp: string): string => {
  if (!timestamp || timestamp.length < 12) return timestamp;

  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  const hour = timestamp.slice(8, 10);
  const minute = timestamp.slice(10, 12);

  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);

  const monthName = date.toLocaleString("en-US", { month: "short" });
  const dayWithSuffix = getDayWithSuffix(date.getDate());
  const yearNum = date.getFullYear();
  const time = date
    .toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();

  return `${monthName} ${dayWithSuffix}, ${yearNum} ${time}`;
};

const getDayWithSuffix = (day: number): string => {
  if (day >= 11 && day <= 13) return `${day}th`;

  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
};


// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const CommitGraph: React.FC<CommitGraphProps> = ({
  commits,
  onCheckout,
  onDeleteCommit,
  onBranchCreate,
  currentCommitId,
  lastCheckoutTimestamp,
  hasUnsavedChanges = false,
  restoringCommitId,
  projectName,
  currentBranch,
  onSaveCommit,
  onCancelSave,
  isCommitting = false,
  isCreatingCommit = false,
  unsavedCount = 0,
  unsavedSummary,
  unsavedSelected = false,
  onSelectUnsaved,
  unsavedBaseMessage,
  onDiscard,
  selectedCommitId: selectedCommitIdProp,
  onCommitSelect,
  tagColors = {},
  onEditTags,
  readOnly = false,
  forks = [],
  me,
  onPreviewFork,
  onDismissFork,
  forkMenu,
}) => {
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);
  const [_currentPage, _setCurrentPage] = useState<number>(0); // Keeping state for now but layout is horizontal
  const [newCommitMessage, setNewCommitMessage] = useState("");
  const [isExiting] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Use prop if provided (even if null), otherwise use local state fallback
  const effectiveSelectedCommitId = selectedCommitIdProp ?? selectedCommitId;

  // Enable vertical-to-horizontal scrolling
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // If we are scrolling vertically, move the container horizontally instead
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commitId: string;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Branch modal state
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchFromCommitId, setBranchFromCommitId] = useState<string | null>(
    null,
  );
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);

  // Preview state
  const [_previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [previewingCommitId, setPreviewingCommitId] = useState<string | null>(
    null,
  );

  // Close context menu on click outside
  useClickOutside(
    contextMenuRef,
    useCallback(() => setContextMenu(null), []),
    !!contextMenu,
  );

  // Set first commit (newest) as selected by default
  // Update selection whenever commits change (e.g., after creating a new commit)
  useEffect(() => {
    if (commits.length > 0) {
      // Sort to get the newest commit (highest timestamp)
      const sortedCommits = [...commits].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
      );
      const newestCommitId = sortedCommits[0].commit_id;

      // Only update if the newest commit is different from the currently selected one
      // This ensures new commits are automatically selected
      if (selectedCommitId !== newestCommitId) {
        setSelectedCommitId(newestCommitId);
      }
    }
    // Intentionally only re-run when the commit list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commits]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleRowClick = (commitId: string) => {
    // Call parent handler if provided
    if (onCommitSelect) {
      onCommitSelect(commitId);
    }
    // Also update local state for internal tracking/fallback
    setSelectedCommitId(commitId);

    // Find which page this commit is on and navigate there
    const sortedCommits = [...commits].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
    // Find which page this commit is on (keeping logic if pagination is ever restored)
    const commitIndex = sortedCommits.findIndex(
      (c) => String(c.commit_id) === String(commitId),
    );

    if (commitIndex !== -1) {
      const pageIndex = Math.floor(commitIndex / 10);
      if (pageIndex !== _currentPage) {
        _setCurrentPage(pageIndex);
      }
    }
  };

  const handleCheckoutClick = (e: React.MouseEvent, commitId: string) => {
    e.stopPropagation();
    onCheckout(commitId);
  };

  // Listen for preview status updates from main process
  useEffect(() => {
    const handleStatusUpdate = (_event: any, status: string) => {
      setPreviewStatus(status);
      // Forward to notification component via custom event
      window.dispatchEvent(
        new CustomEvent("preview-status-update", {
          detail: { status },
        }),
      );
    };

    window.ipcRenderer.on("preview-status-update", handleStatusUpdate);

    return () => {
      window.ipcRenderer.removeAllListeners("preview-status-update");
      // Cleanup preview files when component unmounts
      window.ipcRenderer
        .invoke("cleanup-preview")
        .catch((err: any) => console.error("Cleanup failed:", err));
    };
  }, []);

  // Context menu handler for commits
  const handleCommitContextMenu = (e: React.MouseEvent, commitId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, commitId });
  };

  // Handler when "Branch from this Commit" is clicked
  const handleBranchFromCommit = () => {
    if (contextMenu) {
      setBranchFromCommitId(contextMenu.commitId);
      setContextMenu(null);
      setShowBranchModal(true);
    }
  };

  // Handler when "Delete Commit" is clicked
  const handleDeleteCommit = () => {
    if (contextMenu && onDeleteCommit) {
      onDeleteCommit(contextMenu.commitId);
      setContextMenu(null);
    }
  };

  // Handler when "Edit Version Tags" is clicked
  const handleEditTags = () => {
    if (contextMenu && onEditTags) {
      onEditTags(contextMenu.commitId, contextMenu.x, contextMenu.y);
      setContextMenu(null);
    }
  };

  // Handler when "Preview this Version" is clicked
  const handlePreviewCommit = async () => {
    if (!contextMenu) return;

    const commitId = contextMenu.commitId;
    setContextMenu(null);

    // Prevent multiple simultaneous previews
    if (previewingCommitId) {
      console.log("[CommitGraph] Preview already in progress");
      return;
    }

    setPreviewingCommitId(commitId);
    setPreviewStatus("Preparing...");

    // Dispatch event to show notification
    window.dispatchEvent(
      new CustomEvent("preview-start", {
        detail: { commitId, projectName, branch: currentBranch },
      }),
    );

    try {
      console.log(
        "[CommitGraph] Previewing commit:",
        commitId,
        "from branch:",
        currentBranch,
      );
      await window.ipcRenderer.invoke(
        "preview-project",
        projectName,
        commitId,
        currentBranch,
      );
      console.log("[CommitGraph] Preview opened successfully");

      // Dispatch completion event
      window.dispatchEvent(
        new CustomEvent("preview-complete", {
          detail: { commitId },
        }),
      );
    } catch (error: any) {
      console.error("[CommitGraph] Preview failed:", error);
      notify.error("Couldn't preview this version", error);

      // Dispatch failure event to hide notification
      window.dispatchEvent(new CustomEvent("preview-complete"));
    } finally {
      setPreviewingCommitId(null);
      setPreviewStatus(null);
    }
  };

  // Close the branch modal
  const handleCloseBranchModal = () => {
    setShowBranchModal(false);
    setBranchName("");
    setBranchFromCommitId(null);
  };

  // Handle branch creation
  const handleCreateBranch = async () => {
    if (!branchName.trim()) {
      console.error("[CommitGraph] Branch name cannot be empty");
      return;
    }

    if (!branchFromCommitId) {
      console.error("[CommitGraph] No commit ID specified for branch creation");
      return;
    }

    setIsCreatingBranch(true);
    try {
      console.log("[CommitGraph] Creating branch:", {
        branchName: branchName.trim(),
        fromCommitId: branchFromCommitId,
      });

      if (onBranchCreate) {
        await onBranchCreate(branchName.trim(), branchFromCommitId);
      }

      handleCloseBranchModal();
    } catch (error) {
      console.error("[CommitGraph] Error creating branch:", error);
      // Keep modal open on error so user can retry
    } finally {
      setIsCreatingBranch(false);
    }
  };

  // ============================================================================
  // PAGINATION CALCULATIONS
  // ============================================================================

  // Sort commits by timestamp in descending order (newest first)
  const sortedCommits = [...commits].sort((a, b) => {
    // Compare timestamps as strings (format: YYYYMMDDHHmmss)
    return b.timestamp.localeCompare(a.timestamp);
  });

  // ============================================================================
  // RENDER
  // ============================================================================

  if (commits.length === 0) {
    return (
      <div className="commit-graph-wrapper">
        <h2 className="commit-graph-title">Last Snapshot</h2>
        <div className="commit-graph-container">
          <div className="commit-graph-empty">
            <p>No saves to display</p>
          </div>
        </div>
      </div>
    );
  }

  const selected = unsavedSelected ? null : sortedCommits.find((c) => String(c.commit_id) === String(effectiveSelectedCommitId)) ?? null;
  const selectedStatus = selected ? getCommitStatus(selected, currentCommitId, lastCheckoutTimestamp, hasUnsavedChanges) : null;
  const isRestoringSelected = !!selected && String(restoringCommitId) === String(selected.commit_id);

  return (
    <div className="commit-graph-wrapper">
      <VersionRail
        commits={sortedCommits}
        forks={forks}
        currentCommitId={currentCommitId}
        selectedCommitId={unsavedSelected ? null : effectiveSelectedCommitId}
        me={me}
        onSelect={handleRowClick}
        onContextMenu={handleCommitContextMenu}
        onPreviewFork={onPreviewFork}
        onDismissFork={onDismissFork}
        forkMenu={forkMenu}
        head={
          <div className="rail-head">
          {/* Unsaved changes: only when files changed (or Save was asked for), as one compact block on the rail */}
          {(hasUnsavedChanges || isCreatingCommit || isExiting) &&
            onSaveCommit && (
              <form
                className="unsaved-block"
                aria-label="Unsaved changes"
                data-rail-mark="unsaved"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newCommitMessage.trim() && !isCommitting) onSaveCommit(newCommitMessage);
                }}
              >
                <span className="rail-gutter" aria-hidden />
                <div
                  className={`unsaved-card${unsavedSelected && hasUnsavedChanges ? " selected" : ""}`}
                  onClick={(e) => {
                    // A click on the card (not its field or buttons) shows the changes on the right.
                    if (!hasUnsavedChanges || !onSelectUnsaved) return;
                    if ((e.target as HTMLElement).closest("input, button")) return;
                    onSelectUnsaved();
                  }}
                >
                  <div className="unsaved-head" role="status">
                    <span className="unsaved-title">{hasUnsavedChanges ? "Unsaved changes" : "No changes since the last save"}</span>
                    {hasUnsavedChanges && (
                      <span className="unsaved-count">· {unsavedCount} file{unsavedCount === 1 ? "" : "s"}</span>
                    )}
                  </div>
                  {hasUnsavedChanges && unsavedSummary && unsavedSummary.length > 0 && (
                    <ul className="unsaved-summary" aria-label="What changed">
                      {unsavedSummary.slice(0, 3).map((line) => <li key={line}>{line}</li>)}
                      {unsavedSummary.length > 3 && <li className="more">and {unsavedSummary.length - 3} more</li>}
                    </ul>
                  )}
                  <div className="unsaved-line">
                    <input
                      id="version-message"
                      className="unsaved-input"
                      aria-label="Version message"
                      placeholder="Describe this version"
                      value={newCommitMessage}
                      onChange={(e) => setNewCommitMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
                      autoComplete="off"
                    />
                    <button type="submit" className="unsaved-btn primary" disabled={isCommitting || !newCommitMessage.trim()}>
                      {isCommitting ? "Saving…" : "Save"}
                    </button>
                    {hasUnsavedChanges && onDiscard && (
                      <button type="button" className="unsaved-btn quiet" onClick={onDiscard} disabled={isCommitting || isExiting} title="Go back to the last saved version">
                        Discard
                      </button>
                    )}
                    {isCreatingCommit && !hasUnsavedChanges && (
                      <button
                        type="button"
                        className="unsaved-btn quiet"
                        onClick={() => {
                          setNewCommitMessage("");
                          if (onCancelSave) onCancelSave();
                        }}
                        disabled={isCommitting}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </form>
            )}

          </div>
        }
      />

      {unsavedSelected && hasUnsavedChanges && (
        <div className="selected-version unsaved" aria-label="Selected version">
          <div className="selected-version-text">
            <strong>Unsaved changes</strong>
            <span>In your project folder, compared with {unsavedBaseMessage ? `“${railMessage(unsavedBaseMessage)}”` : "the last saved version"}</span>
          </div>
        </div>
      )}

      {selected && (
        <div className="selected-version" aria-label="Selected version">
          <div className="selected-version-text">
            <strong>{railMessage(selected.message)}</strong>
            <span>{selected.author || "Unknown"} · {formatTimestamp(selected.timestamp)}{selected.auto ? " · kept automatically before a switch" : ""}</span>
          </div>
          <div className="selected-version-actions">
            {(selected.tags || []).length > 0 && (
              <TagChip
                tag={selected.tags![0]}
                color={tagColors[selected.tags![0]]}
                onClick={onEditTags ? (e) => { e.stopPropagation(); onEditTags(selected.commit_id, e.clientX, e.clientY); } : undefined}
              />
            )}
            <button
              type="button"
              className="card-more"
              aria-label="More actions for this version"
              title="More actions"
              aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setContextMenu({ x: r.left, y: r.bottom + 4, commitId: selected.commit_id });
              }}
            >
              <MoreHorizontal size={18} />
            </button>
            {!readOnly && (
              <button
                className={`status-button ${isRestoringSelected ? "restoring" : selectedStatus}`}
                onClick={(e) => handleCheckoutClick(e, selected.commit_id)}
                disabled={isRestoringSelected || selectedStatus === "current"}
              >
                {isRestoringSelected ? (
                  <><RotateCcw className="animate-spin-reverse mr-2" size={16} /> Restoring</>
                ) : selectedStatus === "current" || selectedStatus === "modified" ? (
                  <>On this Mac <Check className="ml-2" size={16} /></>
                ) : selectedStatus === "sync" ? (
                  <>Get this version <RotateCcw className="ml-2" size={16} /></>
                ) : selected.auto ? (
                  <>Bring back <RotateCcw className="ml-2" size={16} /></>
                ) : (
                  <>Restore <RotateCcw className="ml-2" size={16} /></>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Commit Context Menu */}
      {contextMenu && (
        <ContextMenu
          ref={contextMenuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          items={createCommitMenuItems(
            handlePreviewCommit,
            readOnly ? undefined : handleBranchFromCommit,
            onDeleteCommit && !readOnly ? handleDeleteCommit : undefined,
            onEditTags && !readOnly ? handleEditTags : undefined,
          )}
        />
      )}

      {/* Branch From Commit Modal */}
      <InputModal
        isOpen={showBranchModal}
        title="New alternative"
        label="Name of the alternative"
        value={branchName}
        onChange={setBranchName}
        onSubmit={handleCreateBranch}
        onClose={handleCloseBranchModal}
        placeholder="e.g. louder chorus"
        submitText="Create alternative"
        cancelText="Cancel"
        isLoading={isCreatingBranch}
        loadingText="Creating…"
      />
    </div>
  );
};
