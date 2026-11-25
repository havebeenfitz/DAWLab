import type React from 'react';
import { Music, Loader2, Play, Square, AudioLines, X } from 'lucide-react';
import { facetColor } from '@/lib/facets';
import type { Facet } from '@/lib/facets';
import { PlaybackBar } from '@/components/PlaybackBar';
import type { Project, AudioItem } from '@/types/library';
import { getProjectIcon } from '../libraryDisplay';

type PreviewTile = { kind: 'project'; daw?: string } | { kind: 'audio' };

/** Projects first, then audio items — what a folder's 2x2 preview shows. */
export function folderPreviewTiles(childProjects: Project[], childAudio: AudioItem[]): PreviewTile[] {
  return [
    ...childProjects.map(p => ({ kind: 'project' as const, daw: p.daw })),
    ...childAudio.map(() => ({ kind: 'audio' as const })),
  ];
}

/** The folder icon: up to four of its items' icons in a 2x2 grid. */
export function FolderPeekTile({ tiles, iconSize }: { tiles: PreviewTile[]; iconSize: number }) {
  return (
    <div className="folder-peek-tile">
      {Array.from({ length: 4 }).map((_, i) => {
        const t = tiles[i];
        return (
          <div key={i} className="folder-peek-slot">
            {t ? (
              t.kind === 'project' ? (
                getProjectIcon(t.daw) ? (
                  <img src={getProjectIcon(t.daw)!} alt={t.daw} />
                ) : (
                  <Music size={iconSize} />
                )
              ) : (
                <AudioLines size={iconSize} />
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface PreviewToggleProps {
  className: string;
  iconSize: number;
  isPlaying: boolean;
  isLoading: boolean;
  ariaLabel: string;
  onToggle: () => void;
}

/** Play / stop button on a card or row (spinner while loading). */
export function PreviewToggleButton(p: PreviewToggleProps) {
  return (
    <button
      className={p.className}
      onClick={(e) => { e.stopPropagation(); p.onToggle(); }}
      aria-label={p.ariaLabel}
    >
      {p.isLoading ? (
        <Loader2 size={p.iconSize} className="animate-spin" />
      ) : p.isPlaying ? (
        <Square size={p.iconSize} />
      ) : (
        <Play size={p.iconSize} />
      )}
    </button>
  );
}

/** Progress bar shown on a card or row while its audio is loaded (playing or paused). */
export function ItemPlaybar({ className, getElement }: { className: string; getElement: () => HTMLAudioElement | null }) {
  return <div className={className}><PlaybackBar getElement={getElement} /></div>;
}

interface FacetChipProps {
  facet: Facet;
  tagColors: Record<string, string>;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
}

/** Rectangular facet chip (used in both the filter panel and the on-page bar). */
export function FacetChip({ facet, tagColors, active, onClick, onRemove }: FacetChipProps) {
  return (
    <button
      className={`facet-chip${active ? ' facet-chip--active' : ''}${onRemove ? ' facet-chip--removable' : ''}`}
      style={{ ['--facet-color']: facetColor(facet, tagColors) } as React.CSSProperties}
      onClick={onClick}
      title={facet.label}
    >
      <span className="facet-chip-label">{facet.label}</span>
      {onRemove && (
        <span
          className="facet-chip-remove"
          role="button"
          aria-label={`Remove ${facet.label} filter`}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <X size={12} />
        </span>
      )}
    </button>
  );
}
