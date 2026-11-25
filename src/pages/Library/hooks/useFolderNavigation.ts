import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Folder } from '@/types/library';

// Session-scoped key remembering which folder the library is currently showing,
// so navigating away to a project and back restores that folder.
const CURRENT_FOLDER_KEY = 'dawlab-current-folder';

export interface Breadcrumb { id: string | null; name: string }

/** "My Files" followed by every folder from the root down to `currentFolderId`. */
export function buildBreadcrumbs(folders: Folder[], currentFolderId: string | null): Breadcrumb[] {
  const breadcrumbs: Breadcrumb[] = [{ id: null, name: 'My Files' }];
  const folder = currentFolderId ? folders.find(f => f.id === currentFolderId) : undefined;
  if (!folder) return breadcrumbs;
  const path: Folder[] = [folder];
  let parentId = folder.parentId;
  while (parentId) {
    const parent = folders.find(f => f.id === parentId);
    if (!parent) break;
    path.unshift(parent);
    parentId = parent.parentId;
  }
  return [...breadcrumbs, ...path.map(f => ({ id: f.id, name: f.name }))];
}

/**
 * The folder the Library is showing. Restored from the session so returning
 * from a project (via the back button) reopens the folder you were browsing.
 */
export function useCurrentFolder(loading: boolean, folders: Folder[], onFolderChange: () => void) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(
    () => sessionStorage.getItem(CURRENT_FOLDER_KEY) || null
  );

  // e.g. stop any playing preview when the visible folder changes.
  useEffect(() => { onFolderChange(); }, [currentFolderId, onFolderChange]);

  // Persist the open folder so the back button can restore it on return.
  useEffect(() => {
    if (currentFolderId) sessionStorage.setItem(CURRENT_FOLDER_KEY, currentFolderId);
    else sessionStorage.removeItem(CURRENT_FOLDER_KEY);
  }, [currentFolderId]);

  // If the restored folder no longer exists (deleted, or a different user's
  // session), fall back to the root rather than showing an empty view.
  useEffect(() => {
    if (loading) return;
    if (currentFolderId && !folders.some(f => f.id === currentFolderId)) {
      setCurrentFolderId(null);
    }
  }, [loading, folders, currentFolderId]);

  return { currentFolderId, setCurrentFolderId };
}

/** Folder peek (iOS-style): single click opens an in-place preview; double click enters. */
export function useFolderPeek(setCurrentFolderId: (folderId: string | null) => void) {
  const [peek, setPeek] = useState<{ folderId: string; rect: DOMRect } | null>(null);
  const folderClickTimer = useRef<number | null>(null);

  const enterFolder = useCallback((folderId: string) => {
    if (folderClickTimer.current) {
      window.clearTimeout(folderClickTimer.current);
      folderClickTimer.current = null;
    }
    setPeek(null);
    setCurrentFolderId(folderId);
  }, [setCurrentFolderId]);

  // Single click opens the peek after a short delay; a double click cancels it and
  // enters the folder outright (iOS-style disambiguation).
  const handleFolderClick = useCallback((e: React.MouseEvent, folderId: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (folderClickTimer.current) window.clearTimeout(folderClickTimer.current);
    folderClickTimer.current = window.setTimeout(() => {
      folderClickTimer.current = null;
      setPeek({ folderId, rect });
    }, 220);
  }, []);

  // Clean up a pending peek timer on unmount.
  useEffect(() => () => {
    if (folderClickTimer.current) window.clearTimeout(folderClickTimer.current);
  }, []);

  return { peek, closePeek: () => setPeek(null), enterFolder, handleFolderClick };
}
