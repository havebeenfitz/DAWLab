import type { ViewOrderItem } from '../libraryDisplay';
import { FolderTile, AudioTile, ProjectTile } from './GridItems';
import { FolderRow, AudioRow, ProjectRow } from './ListRows';
import type { LibraryItemContext } from './itemContext';

const RENDERERS = {
  grid: { folder: FolderTile, audio: AudioTile, project: ProjectTile },
  list: { folder: FolderRow, audio: AudioRow, project: ProjectRow },
} as const;

interface Props {
  viewMode: 'grid' | 'list';
  viewOrder: ViewOrderItem[];
  ctx: LibraryItemContext;
}

/** The visible items in their manual order, as grid tiles or list rows. */
export function LibraryItems({ viewMode, viewOrder, ctx }: Props) {
  const r = RENDERERS[viewMode];
  return (
    <>
      {viewOrder.map(({ kind, id }) => {
        if (kind === 'folder') {
          const folder = ctx.folders.find(f => f.id === id);
          return folder ? <r.folder key={`folder-${folder.id}`} ctx={ctx} item={folder} /> : null;
        }
        if (kind === 'audio') {
          const audio = ctx.audioItems.find(a => a.id === id);
          return audio ? <r.audio key={`audio-${audio.id}`} ctx={ctx} item={audio} /> : null;
        }
        const project = ctx.projects.find(p => p.id === id);
        return project ? <r.project key={`project-${project.id}`} ctx={ctx} item={project} /> : null;
      })}
    </>
  );
}
