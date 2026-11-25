/**
 * Builders for the Library's right-click menus. Each item closes the menu as
 * part of its action, in the same order as before (close first or last).
 */
import { FolderPlus, FileMusic, Play, Square, AudioLines, Pencil, Trash2, Tag, Users, Share2, ExternalLink, ArchiveX } from 'lucide-react';
import { createFolderMenuItems } from '@/components/ContextMenu';
import type { ContextMenuItem } from '@/components/ContextMenu';

export interface LibraryContextMenuState {
  x: number;
  y: number;
  type: 'folder' | 'empty' | 'project' | 'audio';
  folderId?: string;
  projectId?: string;
  audioId?: string;
}

interface FolderMenuActions {
  isShared: boolean;
  close: () => void;
  share: () => void;
  rename: () => void;
  remove: () => void;
  /** Takes the folder and every project in it out of DAWLab. Absent for shared folders. */
  removeFromLibrary?: () => void;
}

export function buildFolderMenuItems(a: FolderMenuActions): ContextMenuItem[] {
  return [
    {
      label: a.isShared ? 'Sharing…' : 'Share Folder…',
      icon: <Users size={14} />,
      onClick: () => { a.close(); a.share(); },
    },
    ...createFolderMenuItems(
      () => { a.rename(); a.close(); },
      () => { a.remove(); a.close(); }
    ),
    ...(a.removeFromLibrary ? [{
      label: 'Remove from DAWLab…',
      icon: <ArchiveX size={14} />,
      danger: true,
      onClick: () => { a.close(); a.removeFromLibrary!(); },
    }] : []),
  ];
}

interface ProjectMenuActions {
  close: () => void;
  open: () => void;
  share: () => void;
  manageTags: () => void;
  /** Label count: how many selected projects the removal applies to. Absent when not allowed. */
  removeCount?: number;
  removeFromLibrary?: () => void;
}

export function buildProjectMenuItems(a: ProjectMenuActions): ContextMenuItem[] {
  return [
    {
      label: 'Open',
      icon: <ExternalLink size={14} />,
      onClick: () => { a.close(); a.open(); },
    },
    {
      label: 'Share…',
      icon: <Share2 size={14} />,
      onClick: () => { a.close(); a.share(); },
    },
    {
      label: 'Manage Tags',
      icon: <Tag size={14} />,
      onClick: () => { a.manageTags(); a.close(); },
    },
    ...(a.removeFromLibrary ? [{
      label: a.removeCount && a.removeCount > 1 ? `Remove ${a.removeCount} Projects from DAWLab…` : 'Remove from DAWLab…',
      icon: <ArchiveX size={14} />,
      danger: true,
      onClick: () => { a.close(); a.removeFromLibrary!(); },
    }] : []),
  ];
}

interface AudioMenuActions {
  isPlaying: boolean;
  close: () => void;
  togglePlay: () => void;
  rename: () => void;
  remove: () => void;
}

export function buildAudioMenuItems(a: AudioMenuActions): ContextMenuItem[] {
  return [
    {
      label: a.isPlaying ? 'Stop' : 'Play',
      icon: a.isPlaying ? <Square size={14} /> : <Play size={14} />,
      onClick: () => { a.togglePlay(); a.close(); },
    },
    {
      label: 'Rename',
      icon: <Pencil size={14} />,
      onClick: () => { a.rename(); a.close(); },
    },
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      onClick: () => { a.remove(); a.close(); },
    },
  ];
}

interface EmptyMenuActions {
  close: () => void;
  newProject: () => void;
  newFolder: () => void;
  addAudio: () => void;
}

/** Menu for a right click on empty space in the content area. */
export function buildEmptyMenuItems(a: EmptyMenuActions): ContextMenuItem[] {
  return [
    { label: 'New Project', icon: <FileMusic size={14} />, onClick: () => { a.newProject(); a.close(); } },
    { label: 'New Folder', icon: <FolderPlus size={14} />, onClick: () => { a.newFolder(); a.close(); } },
    { label: 'Add Audio', icon: <AudioLines size={14} />, onClick: () => { a.close(); a.addAudio(); } },
  ];
}
