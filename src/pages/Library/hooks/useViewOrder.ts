import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project, Folder, AudioItem } from '@/types/library';
import { viewOrderStorageKey, type ViewOrderItem } from '../libraryDisplay';

const byPosition = (a: { position?: number }, b: { position?: number }) => (a.position ?? 0) - (b.position ?? 0);
const itemKey = (item: ViewOrderItem) => `${item.kind}:${String(item.id)}`;

/** Applies a saved manual order; items not in it go at the end. */
function applySavedOrder(all: ViewOrderItem[], saved: string[]): ViewOrderItem[] {
  if (!saved.length) return all;
  const byKey = new Map(all.map(item => [itemKey(item), item]));
  const ordered = saved.map(k => byKey.get(k)).filter(Boolean) as ViewOrderItem[];
  const savedSet = new Set(saved);
  const newItems = all.filter(item => !savedSet.has(itemKey(item)));
  return [...ordered, ...newItems];
}

/** Returns a copy of each item whose key is in `order`, with position set to its index. */
function withPositions<T extends { id: string; position?: number }>(
  items: T[],
  order: ViewOrderItem[],
  kind: ViewOrderItem['kind'],
): T[] {
  return items.map(it => {
    const idx = order.findIndex(item => item.kind === kind && item.id === it.id);
    return idx >= 0 ? { ...it, position: idx } : it;
  });
}

interface ViewOrderOptions {
  loading: boolean;
  currentFolderId: string | null;
  folders: Folder[];
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  projects: Project[];
  setProjects: Dispatch<SetStateAction<Project[]>>;
  audioItems: AudioItem[];
  setAudioItems: Dispatch<SetStateAction<AudioItem[]>>;
  activeFacets: Set<string>;
  normalizedQuery: string;
  searchedFolders: Folder[];
  searchedProjects: Project[];
  searchedAudioItems: AudioItem[];
}

/** The unified, free-form ordered list of visible items (folders, projects, audio). */
export function useViewOrder(o: ViewOrderOptions) {
  const [viewOrder, setViewOrder] = useState<ViewOrderItem[]>([]);

  // Sync viewOrder when the folder/data changes
  useEffect(() => {
    if (o.loading) return;
    const saved: string[] = JSON.parse(localStorage.getItem(viewOrderStorageKey(o.currentFolderId)) || 'null') ?? [];

    const all: ViewOrderItem[] = [
      ...[...o.searchedFolders].sort((a, b) => a.position - b.position).map(f => ({ kind: 'folder' as const, id: f.id })),
      ...[...o.searchedProjects].sort(byPosition).map(p => ({ kind: 'project' as const, id: p.id })),
      ...[...o.searchedAudioItems].sort(byPosition).map(a => ({ kind: 'audio' as const, id: a.id })),
    ];
    setViewOrder(applySavedOrder(all, saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.currentFolderId, o.loading, o.folders, o.projects, o.audioItems, o.activeFacets, o.normalizedQuery]);

  /** Persists the current order (localStorage + item positions). */
  const saveViewOrder = () => {
    localStorage.setItem(viewOrderStorageKey(o.currentFolderId), JSON.stringify(viewOrder.map(itemKey)));

    const updatedFolders = withPositions(o.folders, viewOrder, 'folder');
    o.setFolders(updatedFolders);
    window.ipcRenderer.invoke('save-folders', updatedFolders);

    o.setProjects(prev => withPositions(prev, viewOrder, 'project'));
    o.setAudioItems(prev => withPositions(prev, viewOrder, 'audio'));
  };

  return { viewOrder, setViewOrder, saveViewOrder };
}
