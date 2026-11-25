import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AudioItem } from '@/types/library';

interface AudioActionsOptions {
  audioItems: AudioItem[];
  setAudioItems: Dispatch<SetStateAction<AudioItem[]>>;
  currentFolderId: string | null;
  loadMyProjects: () => void;
  playingId: string | null;
  stopPreview: () => void;
  closeAddMenu: () => void;
}

/** Imported audio items (bounces / references): add, rename, delete. */
export function useAudioActions(o: AudioActionsOptions) {
  const [showAudioRenameModal, setShowAudioRenameModal] = useState(false);
  const [audioToRename, setAudioToRename] = useState<AudioItem | null>(null);
  const [audioRenameValue, setAudioRenameValue] = useState('');

  // Open the audio-only file picker, copy the chosen files into managed storage,
  // and drop them into the current folder.
  const handleAddAudio = async () => {
    o.closeAddMenu();
    try {
      const paths: string[] = await window.ipcRenderer.invoke('pick-audio-files');
      if (!paths || paths.length === 0) return;
      await window.ipcRenderer.invoke('import-audio-files', paths, o.currentFolderId);
      o.loadMyProjects();
    } catch (err) {
      console.error('[Library] Failed to add audio:', err);
    }
  };

  const initiateAudioRename = (audioId: string) => {
    const a = o.audioItems.find(x => x.id === audioId);
    if (!a) return;
    setAudioToRename(a);
    setAudioRenameValue(a.name);
    setShowAudioRenameModal(true);
  };

  const handleAudioRenameSubmit = () => {
    if (!audioToRename || !audioRenameValue.trim()) return;
    const newName = audioRenameValue.trim();
    o.setAudioItems(prev => prev.map(a => a.id === audioToRename.id ? { ...a, name: newName } : a));
    window.ipcRenderer.invoke('rename-audio-item', audioToRename.id, newName).catch(() => {});
    setShowAudioRenameModal(false);
    setAudioToRename(null);
    setAudioRenameValue('');
  };

  const closeAudioRename = () => { setShowAudioRenameModal(false); setAudioToRename(null); };

  const handleDeleteAudio = (audioId: string) => {
    if (o.playingId === audioId) o.stopPreview();
    o.setAudioItems(prev => prev.filter(a => a.id !== audioId));
    window.ipcRenderer.invoke('delete-audio-item', audioId).catch(() => {});
  };

  return {
    handleAddAudio,
    showAudioRenameModal, audioRenameValue, setAudioRenameValue,
    initiateAudioRename, handleAudioRenameSubmit, closeAudioRename,
    handleDeleteAudio,
  };
}
