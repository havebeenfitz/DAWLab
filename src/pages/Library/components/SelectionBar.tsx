import { Archive, ArchiveX, X } from 'lucide-react';

interface Props {
  count: number;
  /** How many of the selected projects can be archived or removed (not in shared folders). */
  actionable: number;
  busy: boolean;
  allSelected: boolean;
  onSelectAll: () => void;
  onArchive: () => void;
  onRemove: () => void;
  onClear: () => void;
}

/** Shown while projects are selected: bulk actions on all of them at once. */
export function SelectionBar({ count, actionable, busy, allSelected, onSelectAll, onArchive, onRemove, onClear }: Props) {
  if (count === 0) return null;
  const blocked = actionable === 0 || busy;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected projects">
      <span className="selection-bar-count">{count === 1 ? '1 project selected' : `${count} projects selected`}</span>
      {!allSelected && (
        <button type="button" className="selection-bar-btn" onClick={onSelectAll}>Select all</button>
      )}
      <span className="selection-bar-spacer" />
      <button type="button" className="selection-bar-btn" onClick={onArchive} disabled={blocked}
        title={actionable === 0 ? 'Projects in shared folders can\'t be archived' : 'Move to the Archive folder'}>
        <Archive size={14} aria-hidden /> Archive
      </button>
      <button type="button" className="selection-bar-btn selection-bar-danger" onClick={onRemove} disabled={blocked}
        title={actionable === 0 ? 'Projects in shared folders can\'t be removed' : 'Remove from DAWLab, files stay on disk'}>
        <ArchiveX size={14} aria-hidden /> Remove…
      </button>
      <button type="button" className="selection-bar-close" onClick={onClear} aria-label="Clear selection">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
