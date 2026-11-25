import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { Project, AudioItem } from '@/types/library';
import { useMarqueeSelect } from '@/hooks/useMarqueeSelect';
import type { SelectableKind, ViewOrderItem } from '../libraryDisplay';

export interface LibrarySelection {
  keys: Set<string>;
  anchor: string | null;
  focus: string | null;
}

const EMPTY_SELECTION: LibrarySelection = { keys: new Set(), anchor: null, focus: null };
const clearSelection = (prev: LibrarySelection) => (prev.keys.size ? { keys: new Set<string>(), anchor: null, focus: null } : prev);

/** Next selection after clicking `key` (Shift = range from the anchor, Cmd/Ctrl = toggle). */
function nextSelection(prev: LibrarySelection, key: string, e: React.MouseEvent, selectableKeys: string[]): LibrarySelection {
  if (e.shiftKey && prev.anchor) {
    const a = selectableKeys.indexOf(prev.anchor);
    const b = selectableKeys.indexOf(key);
    if (a !== -1 && b !== -1) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return { keys: new Set(selectableKeys.slice(lo, hi + 1)), anchor: prev.anchor, focus: key };
    }
  }
  if (e.metaKey || e.ctrlKey) {
    const next = new Set(prev.keys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return { keys: next, anchor: key, focus: next.has(key) ? key : (Array.from(next).pop() ?? null) };
  }
  return { keys: new Set([key]), anchor: key, focus: key };
}

/** Keeps only the selection (and Quick Look) entries still on screen. */
function pruneSelection(prev: LibrarySelection, visible: Set<string>): LibrarySelection {
  const kept = Array.from(prev.keys).filter(k => visible.has(k));
  if (kept.length === prev.keys.size && (!prev.focus || visible.has(prev.focus))) return prev;
  return {
    keys: new Set(kept),
    anchor: prev.anchor && visible.has(prev.anchor) ? prev.anchor : null,
    focus: prev.focus && visible.has(prev.focus) ? prev.focus : (kept[kept.length - 1] ?? null),
  };
}

const isTypingTarget = (target: HTMLElement | null) =>
  !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

interface SelectionOptions {
  viewOrder: ViewOrderItem[];
  overlaysOpen: boolean;
  projects: Project[];
  audioItems: AudioItem[];
  playPreview: (project: Project) => unknown;
  playAudio: (audio: AudioItem) => unknown;
}

/**
 * Selection (click / Shift-range / Cmd-toggle / drag-select) of projects and
 * audio items, and the Quick Look panel opened with Space. Keys are
 * `${kind}:${id}` — the same shape viewOrder uses. `focus` is the item Space
 * acts on (the last one clicked). Closing Quick Look never stops playback.
 */
export function useLibrarySelection({ viewOrder, overlaysOpen, projects, audioItems, playPreview, playAudio }: SelectionOptions) {
  const [selection, setSelection] = useState<LibrarySelection>(EMPTY_SELECTION);
  const [quickLook, setQuickLook] = useState<{ kind: SelectableKind; id: string } | null>(null);
  const contentRef = useRef<HTMLElement>(null);

  // Projects and audio items can be selected and auditioned; folders can't.
  const selectableKeys = useMemo(
    () => viewOrder.filter(i => i.kind !== 'folder').map(i => `${i.kind}:${i.id}`),
    [viewOrder]
  );

  const handleItemSelect = (e: React.MouseEvent, kind: SelectableKind, id: string) => {
    setSelection(prev => nextSelection(prev, `${kind}:${id}`, e, selectableKeys));
  };

  // Drag-to-select: press on empty space and sweep a box over cards. Shift/Cmd keeps
  // the current selection and adds to it.
  const { marquee, onMouseDown: onMarqueeMouseDown, consumeClick: consumeMarqueeClick } = useMarqueeSelect({
    containerRef: contentRef,
    enabled: !overlaysOpen,
    onChange: (keys, additive) => {
      setSelection(prev => {
        const union = additive ? new Set([...prev.keys, ...keys]) : new Set(keys);
        const last = keys[keys.length - 1] ?? null;
        return {
          keys: union,
          anchor: keys[0] ?? (additive ? prev.anchor : null),
          focus: last ?? (additive ? prev.focus : null),
        };
      });
    },
  });

  // Clicking anywhere in the content area that isn't a card or control clears the selection.
  const handleGridBackgroundClick = (e: React.MouseEvent) => {
    if (consumeMarqueeClick()) return; // the click that ends a drag-select
    if ((e.target as HTMLElement).closest('.library-item, .list-row, button, input, a, .recently-saved-toast, .folder-peek')) return;
    setSelection(clearSelection);
  };

  // Drop selection / Quick Look for anything no longer on screen (folder change,
  // search, filter, delete).
  useEffect(() => {
    const visible = new Set(selectableKeys);
    setSelection(prev => pruneSelection(prev, visible));
    setQuickLook(prev => (prev && !visible.has(`${prev.kind}:${prev.id}`) ? null : prev));
  }, [selectableKeys]);

  /** Space on the focused item: open Quick Look and play it (if it has audio). */
  const openQuickLookOnFocus = () => {
    if (!selection.focus) return;
    const sep = selection.focus.indexOf(':');
    const kind = selection.focus.slice(0, sep);
    const id = selection.focus.slice(sep + 1);
    if (kind === 'project') {
      const project = projects.find(p => p.id === id);
      if (!project?.hasPreview) return; // nothing to play or show yet
      void playPreview(project);
      setQuickLook({ kind: 'project', id });
    } else if (kind === 'audio') {
      const audio = audioItems.find(a => a.id === id);
      if (!audio) return;
      void playAudio(audio);
      setQuickLook({ kind: 'audio', id });
    }
  };

  // Space opens Quick Look on the focused item and plays it; Space again closes
  // it while the audio keeps playing. Esc clears the selection.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (overlaysOpen) return;
      const target = e.target as HTMLElement | null;
      if (isTypingTarget(target)) return;

      if (e.key === 'Escape') {
        if (!quickLook) setSelection(clearSelection);
        return;
      }
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      // Handled here, so a focused button (e.g. the play button just clicked)
      // must not also treat Space as a click.
      e.preventDefault();
      target?.blur?.();

      if (quickLook) {
        setQuickLook(null);
        return;
      }
      openQuickLookOnFocus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // openQuickLookOnFocus reads exactly selection.focus, projects, audioItems and the play functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlaysOpen, quickLook, selection.focus, projects, audioItems, playPreview, playAudio]);

  const quickLookProject = quickLook?.kind === 'project' ? projects.find(p => p.id === quickLook.id) : undefined;
  const quickLookAudio = quickLook?.kind === 'audio' ? audioItems.find(a => a.id === quickLook.id) : undefined;

  return {
    selection,
    setSelection,
    handleItemSelect,
    handleGridBackgroundClick,
    contentRef,
    marquee,
    onMarqueeMouseDown,
    quickLookProject,
    quickLookAudio,
    closeQuickLook: () => setQuickLook(null),
  };
}
