import { useState } from 'react';
import type React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project, Folder, AudioItem } from '@/types/library';
import { moveBlockNextTo } from '@/lib/reorder';
import type { ItemKind, SelectableKind, ViewOrderItem } from '../libraryDisplay';
import type { LibrarySelection } from './useLibrarySelection';

type GroupItem = { kind: SelectableKind; id: string };

/**
 * The grabbed item. `group` is every item travelling with it: the whole
 * selection when the grabbed item is part of a multi-selection, otherwise just
 * the item itself.
 */
export interface DraggedItem {
  type: ItemKind;
  id: string;
  group: GroupItem[];
}

/** True when `folderId` sits somewhere below `ancestorId`. */
function isDescendant(folders: Folder[], folderId: string, ancestorId: string): boolean {
  let current = folders.find(f => f.id === folderId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    const parentId: string = current.parentId;
    current = folders.find(f => f.id === parentId);
  }
  return false;
}

/** Drag image: a count badge, so it's clear several items are travelling together. */
function setCountDragImage(e: React.DragEvent, count: number) {
  const badge = document.createElement('div');
  badge.className = 'drag-count-badge';
  badge.textContent = `${count} items`;
  document.body.appendChild(badge);
  e.dataTransfer.setDragImage(badge, 24, 16);
  setTimeout(() => badge.remove(), 0);
}

interface DragDropOptions {
  selection: LibrarySelection;
  setSelection: Dispatch<SetStateAction<LibrarySelection>>;
  viewOrder: ViewOrderItem[];
  setViewOrder: Dispatch<SetStateAction<ViewOrderItem[]>>;
  folders: Folder[];
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setAudioItems: Dispatch<SetStateAction<AudioItem[]>>;
}

/** Reordering items by drag, and dragging them (or a selection) into folders. */
export function useLibraryDragDrop(o: DragDropOptions) {
  const [draggedItem, setDraggedItem] = useState<DraggedItem | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  // The grabbed item plus, when it belongs to a multi-selection, the rest of the
  // selection — in on-screen order so the block keeps its arrangement.
  const buildDragGroup = (type: ItemKind, id: string): GroupItem[] => {
    if (type === 'folder') return [];
    const key = `${type}:${id}`;
    if (!o.selection.keys.has(key) || o.selection.keys.size < 2) return [{ kind: type, id }];
    return o.viewOrder
      .filter((i): i is GroupItem => i.kind !== 'folder' && o.selection.keys.has(`${i.kind}:${i.id}`));
  };

  const handleDragStart = (e: React.DragEvent, type: ItemKind, id: string) => {
    const group = buildDragGroup(type, id);
    // Grabbing something outside the selection drags (and selects) just that item.
    if (type !== 'folder' && !o.selection.keys.has(`${type}:${id}`)) {
      o.setSelection({ keys: new Set([`${type}:${id}`]), anchor: `${type}:${id}`, focus: `${type}:${id}` });
    }
    setDraggedItem({ type, id, group });
    e.dataTransfer.effectAllowed = 'move';
    if (group.length > 1) setCountDragImage(e, group.length);
  };

  const isBeingDragged = (kind: ItemKind, id: string): boolean =>
    !!draggedItem && (
      (draggedItem.type === kind && draggedItem.id === id) ||
      draggedItem.group.some(g => g.kind === kind && g.id === id)
    );

  const handleDragEnterItem = (targetId: string, targetKind: ItemKind) => {
    if (!draggedItem) return;
    if (isBeingDragged(targetKind, targetId)) return;
    if (targetKind === 'folder') {
      // Show "drop into folder" indicator instead of reordering
      setDragOverFolderId(targetId);
      return;
    }
    setDragOverFolderId(null);
    o.setViewOrder(prev => moveBlockNextTo(
      prev,
      { kind: draggedItem.type, id: draggedItem.id },
      draggedItem.group.length > 1 ? draggedItem.group : [{ kind: draggedItem.type, id: draggedItem.id }],
      { kind: targetKind, id: targetId },
    ));
  };

  const moveFolderTo = (folderId: string, targetFolderId: string | null) => {
    // Don't move a folder into itself or its descendant
    if (targetFolderId && (folderId === targetFolderId || isDescendant(o.folders, targetFolderId, folderId))) return;
    o.setFolders(prev => prev.map(f => f.id === folderId ? { ...f, parentId: targetFolderId } : f));
    window.ipcRenderer.invoke('move-folder', folderId, targetFolderId);
    // Moved to a different folder context, so it leaves the current view
    o.setViewOrder(prev => prev.filter(item => !(item.id === folderId && item.kind === 'folder')));
  };

  // Move the dragged item — or its whole multi-selection group — into a folder
  // (null = the library root). Used by folder tiles and the breadcrumbs.
  const moveDraggedTo = (targetFolderId: string | null) => {
    if (!draggedItem) return;
    if (draggedItem.type === 'folder') {
      moveFolderTo(draggedItem.id, targetFolderId);
      return;
    }

    const projectIds = new Set(draggedItem.group.filter(g => g.kind === 'project').map(g => g.id));
    const audioIds = new Set(draggedItem.group.filter(g => g.kind === 'audio').map(g => g.id));
    if (projectIds.size) {
      o.setProjects(prev => prev.map(p => projectIds.has(p.id) ? { ...p, folderId: targetFolderId } : p));
      projectIds.forEach(id => window.ipcRenderer.invoke('move-project-to-folder', id, targetFolderId));
    }
    if (audioIds.size) {
      o.setAudioItems(prev => prev.map(a => audioIds.has(a.id) ? { ...a, folderId: targetFolderId } : a));
      audioIds.forEach(id => window.ipcRenderer.invoke('move-audio-item-to-folder', id, targetFolderId));
    }
    o.setViewOrder(prev => prev.filter(item => !isBeingDragged(item.kind, item.id)));
  };

  const handleDropOnFolder = (e: React.DragEvent, targetFolderId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDragOverFolderId(null);
    moveDraggedTo(targetFolderId);
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverFolderId(null);
  };

  return {
    draggedItem,
    setDraggedItem,
    dragOverFolderId,
    setDragOverFolderId,
    handleDragStart,
    isBeingDragged,
    handleDragEnterItem,
    moveDraggedTo,
    handleDropOnFolder,
    handleDragEnd,
  };
}
