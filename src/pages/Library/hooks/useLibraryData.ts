import { useRef, useState } from 'react';
import type { Project, Folder, AudioItem } from '@/types/library';
import { openTaskCount } from '@/lib/projectState';

/** Per-project facet metadata from `get-project-facets`, keyed by project_id. */
interface ProjectFacets {
  bpm: number | null;
  plugins: Array<{ name: string; is_instrument?: boolean }>;
  trackCount: number | null;
  hasPreview: boolean;
  previewCommitId: string | null;
  previewFile: string | null;
  previewCommitMessage: string | null;
  previewCommitTimestamp: string | null;
  versionTags: string[];
}

/** Converts a registry project into the Library's view model. */
function toLibraryProject(
  p: any,
  index: number,
  facetMap: Record<string, ProjectFacets>,
  folderMap: Map<string, string | null>,
): Project {
  const pid = String(p.project_id);
  const facets = facetMap[pid];
  return {
    id: pid,
    name: p.name,
    description: p.description || 'No description',
    daw: p.daw || 'Unknown',
    privacy_flag: p.privacy_flag,
    bpm: facets?.bpm ?? p.bpm ?? null,
    genre: p.genre || 'Unknown',
    created_at: new Date().toISOString(),
    folderId: folderMap.get(pid) || null,
    position: index,
    tags: p.tags || [],
    plugins: facets?.plugins ?? [],
    trackCount: facets?.trackCount ?? null,
    hasPreview: facets?.hasPreview ?? false,
    previewCommitId: facets?.previewCommitId ?? null,
    previewFile: facets?.previewFile ?? null,
    previewCommitMessage: facets?.previewCommitMessage ?? null,
    previewCommitTimestamp: facets?.previewCommitTimestamp ?? null,
    versionTags: facets?.versionTags ?? [],
    stage: p.stage ?? null,
    openTasks: openTaskCount(p.tasks),
  };
}

/** Folders, projects and imported audio items of the Library, loaded over IPC. */
export function useLibraryData() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  // Imported audio files (bounces / references) shown alongside projects/folders.
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** Registry projects as returned by IPC (paths etc.), for the recently-saved check. */
  const rawProjectsRef = useRef<any[]>([]);

  const loadMyProjects = async () => {
    try {
      const ipcFolders = await window.ipcRenderer.invoke('get-folders');
      setFolders((ipcFolders || []).sort((a: Folder, b: Folder) => a.position - b.position));

      const projectFolderMap = await window.ipcRenderer.invoke('get-project-folder-map');
      const folderMap = new Map<string, string | null>(
        Object.entries(projectFolderMap).map(([k, v]) => [k, v as string | null])
      );

      const response = await window.ipcRenderer.invoke('get-all-projects');
      const dawvcsProjects = response.projects || response;
      rawProjectsRef.current = dawvcsProjects;

      // Loaded alongside projects so cards can render auto-facets.
      const facetMap: Record<string, ProjectFacets> =
        await window.ipcRenderer.invoke('get-project-facets').catch(() => ({}));

      setProjects(dawvcsProjects.map((p: any, index: number) => toLibraryProject(p, index, facetMap, folderMap)));

      // Imported audio items (bounces / references) live in the user config.
      const audio: AudioItem[] = await window.ipcRenderer.invoke('get-audio-items').catch(() => []);
      setAudioItems((audio || []).map((a, i) => ({ ...a, position: a.position ?? i })));
    } catch (err) {
      console.error('[Library] Error loading projects:', err);
    }
  };

  return {
    projects, setProjects,
    folders, setFolders,
    audioItems, setAudioItems,
    loading, setLoading,
    rawProjectsRef,
    loadMyProjects,
  };
}
