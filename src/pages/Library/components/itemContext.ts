import type React from 'react';
import type { Project, Folder, AudioItem } from '@/types/library';
import type { ItemKind, SelectableKind } from '../libraryDisplay';
import type { DraggedItem } from '../hooks/useLibraryDragDrop';

/** Everything a grid tile or list row needs to render and react to input. */
export interface LibraryItemContext {
  folders: Folder[];
  projects: Project[];
  audioItems: AudioItem[];
  tagColors: Record<string, string>;
  /** Folders shared with others, keyed by folder id. */
  sharedFolders: Record<string, unknown>;
  selectionKeys: Set<string>;

  draggedItem: DraggedItem | null;
  dragOverFolderId: string | null;
  setDragOverFolderId: (id: string | null) => void;
  isBeingDragged: (kind: ItemKind, id: string) => boolean;
  onDragStart: (e: React.DragEvent, kind: ItemKind, id: string) => void;
  onDragEnterItem: (id: string, kind: ItemKind) => void;
  onDropOnFolder: (e: React.DragEvent, folderId: string) => void;
  /** Drop on a project/audio item: persist the reordered view. */
  onDropOnItem: (e: React.DragEvent) => void;
  onDragEnd: () => void;

  playingId: string | null;
  loadingId: string | null;
  activeId: string | null;
  getAudioElement: () => HTMLAudioElement | null;
  onToggleAudio: (audio: AudioItem) => void;
  onTogglePreview: (project: Project) => void;

  onItemSelect: (e: React.MouseEvent, kind: SelectableKind, id: string) => void;
  onFolderClick: (e: React.MouseEvent, folderId: string) => void;
  /** Double click / Enter on a grid folder (cancels a pending peek). */
  onEnterFolder: (folderId: string) => void;
  /** Double click / Enter on a list folder. */
  onNavigateFolder: (folderId: string) => void;
  onOpenProject: (id: string, name: string) => void;
  onFolderContextMenu: (e: React.MouseEvent, folderId: string) => void;
  onProjectContextMenu: (e: React.MouseEvent, projectId: string) => void;
  onAudioContextMenu: (e: React.MouseEvent, audioId: string) => void;
}

/** Drag-over handler shared by every item: accept the drop, don't let it bubble. */
export const acceptDragOver = (e: React.DragEvent) => { e.stopPropagation(); e.preventDefault(); };

/** Number of items directly inside a folder (projects, audio, subfolders). */
export function folderChildren(ctx: LibraryItemContext, folderId: string) {
  const childProjects = ctx.projects.filter(p => p.folderId === folderId);
  const childAudio = ctx.audioItems.filter(a => a.folderId === folderId);
  const childSubfolders = ctx.folders.filter(f => f.parentId === folderId);
  return { childProjects, childAudio, childSubfolders };
}

/** Class suffix for a folder being dragged or hovered as a drop target. */
export function folderDragClasses(ctx: LibraryItemContext, folderId: string): string {
  const dragging = ctx.draggedItem?.id === folderId && ctx.draggedItem?.type === 'folder' ? ' dragging' : '';
  const over = ctx.dragOverFolderId === folderId && ctx.draggedItem?.id !== folderId ? ' drag-over-folder' : '';
  return dragging + over;
}

/** Class suffix for a project/audio item's drag, playing and selected state. */
export function itemStateClasses(ctx: LibraryItemContext, kind: SelectableKind, id: string): string {
  return `${ctx.isBeingDragged(kind, id) ? ' dragging' : ''}${ctx.playingId === id ? ' playing' : ''}${ctx.selectionKeys.has(`${kind}:${id}`) ? ' selected' : ''}`;
}
