import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { notify } from '@/lib/notify';
import { shouldSkipWarning } from '@/components/WarningModal/WarningModal';
import type { Project, Folder, AudioItem } from '@/types/library';

interface FolderActionsOptions {
  folders: Folder[];
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  projects: Project[];
  audioItems: AudioItem[];
  currentFolderId: string | null;
}

/** Creating, renaming and deleting folders, with their modals' state. */
export function useFolderActions({ folders, setFolders, projects, audioItems, currentFolderId }: FolderActionsOptions) {
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [folderToRename, setFolderToRename] = useState<Folder | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const newFolder: Folder = {
      id: `folder-${Date.now()}`,
      name: newFolderName.trim(),
      expanded: true,
      position: folders.length,
      parentId: currentFolderId,
    };

    const updated = [...folders, newFolder];
    setFolders(updated);
    window.ipcRenderer.invoke('save-folders', updated);
    setNewFolderName('');
    setShowNewFolderModal(false);
  };

  const initiateRename = (folderId: string) => {
    const folder = folders.find(f => f.id === folderId);
    if (folder) {
      setFolderToRename(folder);
      setRenameValue(folder.name);
      setShowRenameModal(true);
    }
  };

  const handleRenameSubmit = () => {
    if (!folderToRename || !renameValue.trim()) return;
    const updated = folders.map(f => f.id === folderToRename.id ? { ...f, name: renameValue.trim() } : f);
    setFolders(updated);
    window.ipcRenderer.invoke('save-folders', updated);
    setShowRenameModal(false);
    setFolderToRename(null);
    setRenameValue('');
  };

  const closeRename = () => { setShowRenameModal(false); setFolderToRename(null); };

  const handleConfirmDelete = (folderIdOverride?: string) => {
    const id = folderIdOverride || folderToDelete?.id;
    if (!id) return;
    setFolders(prev => prev.filter(f => f.id !== id));
    window.ipcRenderer.invoke('delete-folder', id);
    setShowDeleteConfirm(false);
    setFolderToDelete(null);
  };

  /** Deletes an empty folder (after confirming, unless the user opted out). */
  const initiateDelete = async (folderId: string) => {
    const folder = folders.find(f => f.id === folderId);
    const hasProjects = projects.some(p => p.folderId === folderId);
    const hasSubfolders = folders.some(f => f.parentId === folderId);
    const hasAudio = audioItems.some(a => a.folderId === folderId);
    if (hasProjects || hasSubfolders || hasAudio) {
      notify.info('This folder isn\'t empty', 'Move or delete what\'s inside first, then delete the folder.');
      return;
    }
    if (folder) {
      const skip = await shouldSkipWarning('delete-folder');
      if (skip) { handleConfirmDelete(folder.id); }
      else { setFolderToDelete(folder); setShowDeleteConfirm(true); }
    }
  };

  const cancelDelete = () => { setShowDeleteConfirm(false); setFolderToDelete(null); };

  return {
    showNewFolderModal, setShowNewFolderModal, newFolderName, setNewFolderName, handleCreateFolder,
    showRenameModal, renameValue, setRenameValue, initiateRename, handleRenameSubmit, closeRename,
    showDeleteConfirm, folderToDelete, initiateDelete, handleConfirmDelete, cancelDelete,
  };
}
