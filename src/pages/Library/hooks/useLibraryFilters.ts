import { useCallback, useMemo, useState } from 'react';
import type { Project, Folder, AudioItem } from '@/types/library';
import { collectFacets, projectMatchesFacets, facetKey } from '@/lib/facets';
import type { Facet } from '@/lib/facets';
import { getStage } from '@/lib/projectState';

/** Text search over a project's name, DAW, stage, project and version tags, and plugins. */
function projectMatchesQuery(p: Project, query: string): boolean {
  return (
    p.name.toLowerCase().includes(query) ||
    (p.daw || '').toLowerCase().includes(query) ||
    (getStage(p.stage)?.label.toLowerCase().includes(query) ?? false) ||
    (p.tags || []).some(t => t.toLowerCase().includes(query)) ||
    (p.versionTags || []).some(t => t.toLowerCase().includes(query)) ||
    (p.plugins || []).some(pl => pl.name.toLowerCase().includes(query))
  );
}

interface FilterOptions {
  projects: Project[];
  folders: Folder[];
  audioItems: AudioItem[];
  currentFolderId: string | null;
}

/**
 * What the Library shows: the current folder's contents, narrowed by the facet
 * filter and the search box (which looks across every folder while active).
 */
export function useLibraryFilters({ projects, folders, audioItems, currentFolderId }: FilterOptions) {
  const [searchQuery, setSearchQuery] = useState('');
  // Active filter selection, stored as facet keys ("type::value"). OR within a
  // facet type, AND across types — see @/lib/facets.
  const [activeFacets, setActiveFacets] = useState<Set<string>>(new Set());

  const currentListFolders = folders.filter(f => f.parentId === currentFolderId);
  const currentListProjects = projects.filter(p => p.folderId === currentFolderId);
  const currentListAudio = audioItems.filter(a => (a.folderId ?? null) === currentFolderId);

  // All facets across visible projects, grouped by type (for the filter panel).
  const visibleFacetGroups = useMemo(
    () => collectFacets(currentListProjects),
    [currentListProjects]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  // While searching, look across the whole library (into every folder); otherwise
  // stay scoped to the current folder.
  const facetFilteredProjects = useMemo(() => {
    const base = normalizedQuery ? projects : currentListProjects;
    if (activeFacets.size === 0) return base;
    return base.filter(p => projectMatchesFacets(p, activeFacets));
  }, [projects, currentListProjects, activeFacets, normalizedQuery]);

  const searchedProjects = useMemo(() => {
    if (!normalizedQuery) return facetFilteredProjects;
    return facetFilteredProjects.filter(p => projectMatchesQuery(p, normalizedQuery));
  }, [facetFilteredProjects, normalizedQuery]);

  const searchedFolders = useMemo(() => {
    if (!normalizedQuery) return currentListFolders;
    return folders.filter(f => f.name.toLowerCase().includes(normalizedQuery));
  }, [folders, currentListFolders, normalizedQuery]);

  const searchedAudioItems = useMemo(() => {
    if (!normalizedQuery) return currentListAudio;
    return audioItems.filter(a => a.name.toLowerCase().includes(normalizedQuery));
  }, [audioItems, currentListAudio, normalizedQuery]);

  const toggleFacet = useCallback((key: string) => {
    setActiveFacets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearFacets = () => setActiveFacets(new Set());

  // Flat lookup of every visible facet by its key, so the active-filter bar can
  // recover a facet's label/type from a stored key.
  const facetByKey = useMemo(() => {
    const map = new Map<string, Facet>();
    for (const facets of visibleFacetGroups.values()) {
      for (const f of facets) map.set(facetKey(f), f);
    }
    return map;
  }, [visibleFacetGroups]);

  // Active facets resolved to full objects for rendering the on-page filter bar.
  const activeFacetList = useMemo(() => {
    return Array.from(activeFacets).map(key => {
      const found = facetByKey.get(key);
      if (found) return { key, facet: found };
      const [type, value] = key.split('::');
      return { key, facet: { type, value, label: value } as Facet };
    });
  }, [activeFacets, facetByKey]);

  return {
    searchQuery, setSearchQuery, normalizedQuery,
    activeFacets, toggleFacet, clearFacets, activeFacetList, visibleFacetGroups,
    currentListFolders, currentListProjects, currentListAudio,
    searchedProjects, searchedFolders, searchedAudioItems,
  };
}
