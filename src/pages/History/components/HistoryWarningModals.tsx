import { WarningModal } from '@/components/WarningModal/WarningModal';
import { StorageWarningModal } from '@/components/ui/StorageWarningModal';
import type { useCommitActions } from '../hooks/useCommitActions';
import type { useStorageWarning } from '../hooks/useStorageWarning';

interface Props {
  commits: ReturnType<typeof useCommitActions>;
  storage: ReturnType<typeof useStorageWarning>;
  onManageSettings: () => void;
}

/** Confirmations around saving, restoring and deleting versions. */
export function HistoryWarningModals({ commits, storage, onManageSettings }: Props) {
  return (
    <>
      {/* Unsaved Changes Warning Modal */}
      <WarningModal
        isOpen={commits.showUnsavedWarning}
        warningType="unsaved-changes"
        title="You have unsaved changes"
        message={
          <>
            Nothing will be lost: if you restore now, DAWLab first keeps your
            current files as a version marked “Kept automatically”, which you can
            bring back from the history. The folder then becomes an exact copy of
            the version you restore; files it doesn't have go to the Trash.
            <br />
            <br />
            Or save them as a version with a name first, then restore.
          </>
        }
        actions={[
          { label: "Cancel", onClick: commits.handleCancelCheckout, variant: "cancel" },
          {
            label: "Restore",
            onClick: commits.handleProceedAnyway,
            variant: "warning",
          },
          {
            label: "Save First",
            onClick: commits.handleCommitFirst,
            variant: "primary",
          },
        ]}
        onCancel={commits.handleCancelCheckout}
      />
      {/* Duplicate Commit Warning Modal */}
      <WarningModal
        isOpen={commits.showDuplicateWarning}
        warningType="duplicate-commit"
        title="No Changes Detected"
        message={
          <>
            Your project files haven't changed since the last save.
            <br />
            <br />
            This save will be identical to the previous one.
          </>
        }
        actions={[
          {
            label: "Cancel",
            onClick: commits.handleCancelDuplicateCommit,
            variant: "cancel",
          },
          {
            label: "Save Anyway",
            onClick: commits.handleDuplicateCommitAnyway,
            variant: "warning",
          },
        ]}
        onCancel={commits.handleCancelDuplicateCommit}
      />
      {/* Storage Warning Modal */}
      <StorageWarningModal
        isOpen={storage.showStorageWarning}
        onClose={storage.dismissStorageWarning}
        message={storage.storageWarningMessage}
        onManageSettings={() => {
          storage.dismissStorageWarning();
          onManageSettings();
        }}
        onProceedAnyway={
          storage.pendingCheckoutStorageId ? commits.handleProceedCheckoutAnyway : undefined
        }
      />
      {/* Delete Commit Confirmation Modal */}
      <WarningModal
        isOpen={commits.showDeleteConfirmation}
        warningType="delete-commit"
        title="Delete Version"
        showDontAskAgain={false}
        message={
          <>
            Are you sure you want to delete this version?
            <br />
            <br />
            This action cannot be undone. Any files unique to this version will
            be permanently removed.
          </>
        }
        actions={[
          {
            label: "Cancel",
            onClick: commits.handleCancelDeleteCommit,
            variant: "cancel",
          },
          {
            label: commits.isDeletingCommit ? "Deleting..." : "Delete Version",
            onClick: commits.handleConfirmDeleteCommit,
            variant: "destructive",
          },
        ]}
        onCancel={commits.handleCancelDeleteCommit}
      />
    </>
  );
}
