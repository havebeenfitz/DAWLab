import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Plus, FolderPlus, Search, LayoutGrid, List, FileMusic, Filter, X, AudioLines, Link2 } from 'lucide-react';
import logo from '@/assets/logo.png';
import { facetKey, FACET_GROUP_LABELS } from '@/lib/facets';
import type { useLibraryFilters } from '../hooks/useLibraryFilters';
import { FacetChip } from './ItemParts';
import { NotificationBell } from '@/components/Notifications/NotificationBell';

type ViewMode = 'grid' | 'list';
type Filters = ReturnType<typeof useLibraryFilters>;

function ViewToggle({ viewMode, onChange }: { viewMode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="view-toggle">
      <button
        className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid size={18} />
      </button>
      <button
        className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
        onClick={() => onChange('list')}
      >
        <List size={18} />
      </button>
    </div>
  );
}

function SearchBox({ searchQuery, setSearchQuery }: Pick<Filters, 'searchQuery' | 'setSearchQuery'>) {
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`search-wrapper${showSearch ? ' expanded' : ''}`}>
      <button
        className={`icon-btn search-btn${searchQuery ? ' active' : ''}`}
        onClick={() => {
          setShowSearch(prev => {
            const next = !prev;
            if (next) setTimeout(() => searchInputRef.current?.focus(), 0);
            return next;
          });
        }}
        aria-label="Search projects"
      >
        <Search size={18} />
      </button>
      <input
        ref={searchInputRef}
        className="search-input"
        type="text"
        placeholder="Search by name, stage, tag, plugin…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setSearchQuery(''); setShowSearch(false); }
        }}
      />
      {searchQuery && (
        <button
          className="search-clear"
          onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

interface FilterMenuProps {
  filters: Filters;
  tagColors: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  menuRef: RefObject<HTMLDivElement>;
}

function FilterMenu({ filters, tagColors, open, onToggle, menuRef }: FilterMenuProps) {
  const { activeFacets, visibleFacetGroups } = filters;
  return (
    <div className="filter-btn-wrapper" ref={menuRef}>
      <button
        className={`icon-btn filter-btn${activeFacets.size > 0 ? ' active' : ''}`}
        onClick={onToggle}
        aria-label="Filter projects"
      >
        <Filter size={18} />
        {activeFacets.size > 0 && (
          <span className="filter-active-badge">{activeFacets.size}</span>
        )}
      </button>
      {open && (
        <div className="filter-dropdown filter-dropdown--faceted">
          <div className="filter-panel-header">
            <span className="filter-panel-title">Filters</span>
            {activeFacets.size > 0 && (
              <button
                className="filter-panel-clear"
                onClick={filters.clearFacets}
              >
                Clear all
              </button>
            )}
          </div>
          {visibleFacetGroups.size === 0 ? (
            <span className="filter-dropdown-empty">Nothing to filter in this view</span>
          ) : (
            <div className="filter-facet-groups">
              {Array.from(visibleFacetGroups.entries()).map(([type, facets]) => (
                <div key={type} className="filter-facet-group">
                  <span className="filter-facet-heading">{FACET_GROUP_LABELS[type]}</span>
                  <div className="filter-dropdown-chips">
                    {facets.map(facet => {
                      const key = facetKey(facet);
                      return (
                        <FacetChip
                          key={key}
                          facet={facet}
                          tagColors={tagColors}
                          active={activeFacets.has(key)}
                          onClick={() => filters.toggleFacet(key)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AddMenuProps {
  open: boolean;
  onToggle: () => void;
  menuRef: RefObject<HTMLDivElement>;
  onNewProject: () => void;
  onNewFolder: () => void;
  onAddAudio: () => void;
  onJoinShared: () => void;
}

function AddMenu(p: AddMenuProps) {
  return (
    <div className="add-btn-wrapper" ref={p.menuRef}>
      <button className="icon-btn add-btn" onClick={p.onToggle} aria-label="Add" title="Add a project, folder or audio" aria-haspopup="menu" aria-expanded={p.open}>
        <Plus size={18} />
      </button>
      {p.open && (
        <div className="add-dropdown">
          <button className="add-dropdown-item" onClick={p.onNewProject}>
            <FileMusic size={14} />
            New Project
          </button>
          <button className="add-dropdown-item" onClick={p.onNewFolder}>
            <FolderPlus size={14} />
            New Folder
          </button>
          <button className="add-dropdown-item" onClick={p.onAddAudio}>
            <AudioLines size={14} />
            Add Audio
          </button>
          <button className="add-dropdown-item" onClick={p.onJoinShared}>
            <Link2 size={14} />
            Join Shared Folder…
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  filters: Filters;
  tagColors: Record<string, string>;
  showFilterMenu: boolean;
  onToggleFilterMenu: () => void;
  filterMenuRef: RefObject<HTMLDivElement>;
  addMenu: AddMenuProps;
}

/** Top bar of the Library: logo, grid/list toggle, search, filters and the Add menu. */
export function LibraryHeader(p: Props) {
  return (
    <header className="library-header">
      <div className="header-left">
        <img src={logo} alt="Logo" className="app-logo" />
      </div>

      <div className="header-right">
        <ViewToggle viewMode={p.viewMode} onChange={p.onViewModeChange} />
        <SearchBox searchQuery={p.filters.searchQuery} setSearchQuery={p.filters.setSearchQuery} />
        <FilterMenu
          filters={p.filters}
          tagColors={p.tagColors}
          open={p.showFilterMenu}
          onToggle={p.onToggleFilterMenu}
          menuRef={p.filterMenuRef}
        />
        <NotificationBell />
        <AddMenu {...p.addMenu} />
      </div>
    </header>
  );
}
