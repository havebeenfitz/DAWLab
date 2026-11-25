import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Project } from '@/types/library';
import { buildTagSuggestions } from '@/lib/tags';

const withTag = (projectId: string, tag: string) => (prev: Project[]) =>
  prev.map(p => p.id === projectId ? { ...p, tags: [...(p.tags || []), tag] } : p);

const withoutTag = (projectId: string, tag: string) => (prev: Project[]) =>
  prev.map(p => p.id === projectId ? { ...p, tags: (p.tags || []).filter(t => t !== tag) } : p);

/** Project tags: colours, suggestions, the tag popover and optimistic add/remove. */
export function useProjectTags(projects: Project[], setProjects: Dispatch<SetStateAction<Project[]>>) {
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  const [tagPopover, setTagPopover] = useState<{ x: number; y: number; projectId: string } | null>(null);

  useEffect(() => {
    window.ipcRenderer.invoke('load-tag-colors').then((colors: Record<string, string>) => {
      setTagColors(colors || {});
    }).catch(() => {});
  }, []);

  // Every tag known across the library (used + colored), plus curated defaults —
  // the pool offered when adding a tag to any project.
  const tagSuggestions = useMemo(() => {
    const known = new Set<string>();
    for (const p of projects) for (const t of [...(p.tags || []), ...(p.versionTags || [])]) known.add(t);
    for (const t of Object.keys(tagColors)) known.add(t);
    return buildTagSuggestions(Array.from(known), tagColors);
  }, [projects, tagColors]);

  const handleTagPopoverAdd = (projectId: string, tag: string, color: string) => {
    // Deduplicate
    const project = projects.find(p => p.id === projectId);
    if (!project || (project.tags || []).includes(tag)) return;

    setProjects(withTag(projectId, tag));

    if (color && color !== '#007bff') {
      setTagColors(prev => ({ ...prev, [tag]: color }));
      window.ipcRenderer.invoke('save-tag-color', tag, color).catch(() => {});
    }

    window.ipcRenderer.invoke('add-tag-to-project', projectId, tag).catch(() => {
      setProjects(withoutTag(projectId, tag)); // Revert on failure
    });
  };

  const handleTagPopoverRemove = (projectId: string, tag: string) => {
    setProjects(withoutTag(projectId, tag));

    window.ipcRenderer.invoke('delete-tag-from-project', projectId, tag).catch(() => {
      setProjects(withTag(projectId, tag)); // Revert on failure
    });
  };

  return { tagColors, tagSuggestions, tagPopover, setTagPopover, handleTagPopoverAdd, handleTagPopoverRemove };
}
