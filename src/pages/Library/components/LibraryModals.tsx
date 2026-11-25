import { InputModal } from '@/components/InputModal';
import { WarningModal } from '@/components/WarningModal/WarningModal';
import type { useFolderActions } from '../hooks/useFolderActions';
import type { useAudioActions } from '../hooks/useAudioActions';

interface Props {
  folderActions: ReturnType<typeof useFolderActions>;
  audioActions: ReturnType<typeof useAudioActions>;
}

/** New folder, rename folder/audio and delete-folder dialogs. */
export function LibraryModals({ folderActions: f, audioActions: a }: Props) {
  return (
    <>
      {/* New Folder Modal */}
      <InputModal
        isOpen={f.showNewFolderModal}
        title="Create New Folder"
        label="Folder Name"
        value={f.newFolderName}
        onChange={f.setNewFolderName}
        onSubmit={f.handleCreateFolder}
        onClose={() => f.setShowNewFolderModal(false)}
        submitText="Create"
      />

      {/* Rename Folder Modal */}
      <InputModal
        isOpen={f.showRenameModal}
        title="Rename Folder"
        label="Folder Name"
        value={f.renameValue}
        onChange={f.setRenameValue}
        onSubmit={f.handleRenameSubmit}
        onClose={f.closeRename}
        submitText="Rename"
      />

      {/* Rename Audio Modal */}
      <InputModal
        isOpen={a.showAudioRenameModal}
        title="Rename Audio"
        label="Name"
        value={a.audioRenameValue}
        onChange={a.setAudioRenameValue}
        onSubmit={a.handleAudioRenameSubmit}
        onClose={a.closeAudioRename}
        submitText="Rename"
      />

      {/* Delete Folder Confirmation */}
      <WarningModal
        isOpen={f.showDeleteConfirm && !!f.folderToDelete}
        title="Delete Folder"
        message={f.folderToDelete ? `Are you sure you want to delete "${f.folderToDelete.name}"?` : ''}
        warningType="delete-folder"
        actions={[
          { label: 'Cancel', onClick: f.cancelDelete, variant: 'cancel' },
          { label: 'Delete', onClick: () => f.handleConfirmDelete(), variant: 'destructive' },
        ]}
        onCancel={f.cancelDelete}
      />
    </>
  );
}
