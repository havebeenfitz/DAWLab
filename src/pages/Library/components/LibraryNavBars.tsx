import type React from 'react';
import type { Facet } from '@/lib/facets';
import type { Breadcrumb } from '../hooks/useFolderNavigation';
import { FacetChip } from './ItemParts';

interface ActiveFiltersBarProps {
  facets: Array<{ key: string; facet: Facet }>;
  tagColors: Record<string, string>;
  onToggle: (key: string) => void;
  onClearAll: () => void;
}

/** Active filter chips — visible on the page, not just in the popup. */
export function ActiveFiltersBar({ facets, tagColors, onToggle, onClearAll }: ActiveFiltersBarProps) {
  if (facets.length === 0) return null;
  return (
    <div className="active-filters-bar">
      {facets.map(({ key, facet }) => (
        <FacetChip
          key={key}
          facet={facet}
          tagColors={tagColors}
          active={true}
          onClick={() => onToggle(key)}
          onRemove={() => onToggle(key)}
        />
      ))}
      <button
        className="active-filters-clear"
        onClick={onClearAll}
      >
        Clear all
      </button>
    </div>
  );
}

const markDragOver = (e: React.DragEvent<HTMLElement>) => { e.preventDefault(); e.currentTarget.setAttribute('data-drag-over', 'true'); };
const clearDragOver = (e: React.DragEvent<HTMLElement>) => { e.currentTarget.removeAttribute('data-drag-over'); };

interface BreadcrumbBarProps {
  /** Crumbs below "My Files", root first. */
  crumbs: Breadcrumb[];
  onNavigate: (folderId: string | null) => void;
  /** Drop of dragged items onto a crumb (null = the library root). */
  onDropOnCrumb: (folderId: string | null) => void;
}

/** Path from "My Files" to the open folder; each crumb is also a drop target. */
export function BreadcrumbBar({ crumbs, onNavigate, onDropOnCrumb }: BreadcrumbBarProps) {
  return (
    <div className="breadcrumb-bar">
      <span
        className="crumb-root"
        onClick={() => onNavigate(null)}
        onDragOver={markDragOver}
        onDragLeave={clearDragOver}
        onDrop={(e) => {
          clearDragOver(e);
          onDropOnCrumb(null);
        }}
      >
        My Files
      </span>
      {crumbs.map((crumb, idx, arr) => (
        <span key={crumb.id || `crumb-${idx}`} className="breadcrumb-span">
          <span className="sep">/</span>
          <span
            className={`crumb ${idx === arr.length - 1 ? 'active' : ''}`}
            onClick={() => onNavigate(crumb.id)}
            onDragOver={markDragOver}
            onDragLeave={clearDragOver}
            onDrop={(e) => {
              clearDragOver(e);
              onDropOnCrumb(crumb.id);
            }}
          >
            {crumb.name}
          </span>
        </span>
      ))}
    </div>
  );
}
