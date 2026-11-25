import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { DawType } from '@/components/NewProject/NewProject';
import { DAW_LABEL_TO_TYPE, deriveProjectName, isAudioPath } from '../libraryDisplay';

/** Prefill for the NewProject modal after a valid DAW project was dropped. */
export interface DropInit {
  path: string;
  name: string;
  daw: DawType;
  /** Folder it was dropped into, so it lands there. */
  folderId: string | null;
}

/** The NewProject modal, optionally prefilled from a dropped project. */
export function useNewProjectModal() {
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [dropInit, setDropInit] = useState<DropInit | null>(null);

  const openNewProject = (init?: DropInit) => {
    if (init) setDropInit(init);
    setShowNewProjectModal(true);
  };

  const closeNewProject = () => {
    setShowNewProjectModal(false);
    setDropInit(null);
  };

  return { showNewProjectModal, dropInit, openNewProject, closeNewProject };
}

interface OsFileDropOptions {
  /** True while an internal project/folder drag is in progress. */
  isInternalDrag: boolean;
  currentFolderId: string | null;
  loadMyProjects: () => void;
  openNewProject: (init: DropInit) => void;
}

/**
 * OS file drag-and-drop: dropping audio from Finder imports it; dropping a
 * folder/file that's a valid DAW project opens NewProject prefilled with it.
 */
export function useOsFileDrop({ isInternalDrag, currentFolderId, loadMyProjects, openNewProject }: OsFileDropOptions) {
  const [isFileDragging, setIsFileDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dropErrorTimer = useRef<number | null>(null);

  // True when the drag originates from the OS (a file/folder from Finder) rather
  // than an internal project/folder reorder. Browsers don't expose the dropped
  // item's name or path during hover (the drag data store is protected until
  // drop), so validity can only be checked once the item is actually dropped.
  const isOsFileDrag = (e: React.DragEvent): boolean => {
    if (isInternalDrag) return false;
    const types = e.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  };

  const flashDropError = (message: string) => {
    setDropError(message);
    if (dropErrorTimer.current) window.clearTimeout(dropErrorTimer.current);
    dropErrorTimer.current = window.setTimeout(() => setDropError(null), 2800);
  };

  useEffect(() => () => {
    if (dropErrorTimer.current) window.clearTimeout(dropErrorTimer.current);
  }, []);

  const handleFileDragEnter = (e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    setDropError(null);
    setIsFileDragging(true);
  };

  const handleFileDragOver = (e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isFileDragging) setIsFileDragging(true);
  };

  const handleFileDragLeave = (e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    // relatedTarget is null only when the pointer leaves the window entirely;
    // moving between child elements keeps the overlay up.
    if (e.relatedTarget === null) setIsFileDragging(false);
  };

  const importDroppedAudio = async (audioPaths: string[]) => {
    try {
      await window.ipcRenderer.invoke('import-audio-files', audioPaths, currentFolderId);
      loadMyProjects();
    } catch (err) {
      console.error('[Library] Failed to import dropped audio:', err);
      flashDropError('Could not import audio');
    }
  };

  /** Treats `droppedPath` as a potential DAW project; stays quiet on failure if audio was imported. */
  const handleDroppedProject = async (droppedPath: string, importedAudio: boolean) => {
    let result: { daw?: string; isValid?: boolean } | undefined;
    try {
      result = await window.ipcRenderer.invoke('detect-daw', droppedPath);
    } catch (err) {
      console.error('[Library] detect-daw failed for dropped item:', err);
      if (!importedAudio) flashDropError('Could not read the dropped item');
      return;
    }

    if (!result?.isValid) {
      if (!importedAudio) flashDropError('Not a DAW project or audio file');
      return;
    }

    openNewProject({
      path: droppedPath,
      name: deriveProjectName(droppedPath),
      daw: DAW_LABEL_TO_TYPE[result.daw || ''] ?? 'logic',
      folderId: currentFolderId,
    });
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    if (!isOsFileDrag(e)) return;
    e.preventDefault();
    setIsFileDragging(false);

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;

    const paths = files
      .map(f => window.electronAPI?.getPathForFile?.(f))
      .filter((p): p is string => !!p);
    if (paths.length === 0) {
      flashDropError('Could not read the dropped item');
      return;
    }

    // Audio files are imported as audio items; everything else goes to the
    // DAW-project detection flow (only the first such item).
    const audioPaths = paths.filter(isAudioPath);
    const otherPaths = paths.filter(p => !isAudioPath(p));

    if (audioPaths.length > 0) await importDroppedAudio(audioPaths);
    if (otherPaths.length === 0) return;
    await handleDroppedProject(otherPaths[0], audioPaths.length > 0);
  };

  return {
    isFileDragging,
    dropError,
    clearDropError: () => setDropError(null),
    handleFileDragEnter,
    handleFileDragOver,
    handleFileDragLeave,
    handleFileDrop,
  };
}
