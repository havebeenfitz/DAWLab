import { Music, AudioLines, Users } from 'lucide-react';
import { TagChip } from '@/components/ui/TagChip';
import type { Project, Folder, AudioItem } from '@/types/library';
import { audioMetaLine, getProjectIcon, projectMetaLine } from '../libraryDisplay';
import { FolderPeekTile, ItemPlaybar, PreviewToggleButton, folderPreviewTiles } from './ItemParts';
import {
  acceptDragOver, folderChildren, folderDragClasses, itemStateClasses,
  type LibraryItemContext,
} from './itemContext';

interface TileProps<T> { ctx: LibraryItemContext; item: T }

function TilePlaybar({ ctx, id }: { ctx: LibraryItemContext; id: string }) {
  return ctx.activeId === id ? <ItemPlaybar className="item-playbar" getElement={ctx.getAudioElement} /> : null;
}

export function FolderTile({ ctx, item: folder }: TileProps<Folder>) {
  const { childProjects, childAudio, childSubfolders } = folderChildren(ctx, folder.id);
  const childCount = childProjects.length + childAudio.length + childSubfolders.length;
  return (
    <div
      className={`library-item folder${folderDragClasses(ctx, folder.id)}`}
      draggable={true}
      onDragStart={(e) => ctx.onDragStart(e, 'folder', folder.id)}
      onDragEnter={() => ctx.onDragEnterItem(folder.id, 'folder')}
      onDragOver={acceptDragOver}
      onDragLeave={() => { if (ctx.dragOverFolderId === folder.id) ctx.setDragOverFolderId(null); }}
      onDrop={(e) => ctx.onDropOnFolder(e, folder.id)}
      onDragEnd={ctx.onDragEnd}
      onClick={(e) => ctx.onFolderClick(e, folder.id)}
      onDoubleClick={() => ctx.onEnterFolder(folder.id)}
      tabIndex={0}
      role="button"
      aria-label={`${folder.name}, folder`}
      onKeyDown={(e) => { if (e.key === 'Enter') ctx.onEnterFolder(folder.id); }}
      onContextMenu={(e) => ctx.onFolderContextMenu(e, folder.id)}
    >
      <div className="item-icon-wrapper folder-wrapper">
        <FolderPeekTile tiles={folderPreviewTiles(childProjects, childAudio)} iconSize={18} />
      </div>
      <span className="item-label">{folder.name}</span>
      <span className="item-sublabel">
        {!!ctx.sharedFolders[folder.id] && (
          <span className="shared-badge" title="Shared folder"><Users size={12} aria-hidden /> Shared ·</span>
        )}{' '}
        {childCount === 0 ? 'Empty' : `${childCount} item${childCount === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}

export function AudioTile({ ctx, item: audio }: TileProps<AudioItem>) {
  const isPlaying = ctx.playingId === audio.id;
  return (
    <div
      data-select-key={`audio:${audio.id}`}
      className={`library-item project audio-item${itemStateClasses(ctx, 'audio', audio.id)}`}
      draggable={true}
      onDragStart={(e) => ctx.onDragStart(e, 'audio', audio.id)}
      onDragEnter={() => ctx.onDragEnterItem(audio.id, 'audio')}
      onDragOver={acceptDragOver}
      onDrop={ctx.onDropOnItem}
      onDragEnd={ctx.onDragEnd}
      onClick={(e) => ctx.onItemSelect(e, 'audio', audio.id)}
      onDoubleClick={() => ctx.onToggleAudio(audio)}
      onContextMenu={(e) => ctx.onAudioContextMenu(e, audio.id)}
    >
      <div className="item-icon-wrapper project-wrapper">
        <div className="audio-tile"><AudioLines size={40} /></div>
        <PreviewToggleButton
          className="item-preview-btn"
          iconSize={18}
          isPlaying={isPlaying}
          isLoading={ctx.loadingId === audio.id}
          ariaLabel={isPlaying ? 'Stop' : 'Play'}
          onToggle={() => ctx.onToggleAudio(audio)}
        />
      </div>
      <TilePlaybar ctx={ctx} id={audio.id} />
      <span className="item-label">{audio.name}</span>
      <span className="item-sublabel">{audioMetaLine(audio)}</span>
    </div>
  );
}

function TileTags({ tags, tagColors }: { tags: string[]; tagColors: Record<string, string> }) {
  if (tags.length === 0) return null;
  return (
    <div className="item-tags">
      {tags.slice(0, 2).map(tag => (
        <TagChip key={tag} tag={tag} color={tagColors[tag]} />
      ))}
      {tags.length > 2 && (
        <span className="item-tags-more">+{tags.length - 2}</span>
      )}
    </div>
  );
}

export function ProjectTile({ ctx, item: project }: TileProps<Project>) {
  const isPlaying = ctx.playingId === project.id;
  const icon = getProjectIcon(project.daw);
  return (
    <div
      data-select-key={`project:${project.id}`}
      className={`library-item project${itemStateClasses(ctx, 'project', project.id)}`}
      draggable={true}
      onDragStart={(e) => ctx.onDragStart(e, 'project', project.id)}
      onDragEnter={() => ctx.onDragEnterItem(project.id, 'project')}
      onDragOver={acceptDragOver}
      onDrop={ctx.onDropOnItem}
      onDragEnd={ctx.onDragEnd}
      onClick={(e) => ctx.onItemSelect(e, 'project', project.id)}
      onDoubleClick={() => ctx.onOpenProject(project.id, project.name)}
      tabIndex={0}
      role="button"
      aria-label={`${project.name}, project`}
      onKeyDown={(e) => { if (e.key === 'Enter') ctx.onOpenProject(project.id, project.name); }}
      onContextMenu={(e) => ctx.onProjectContextMenu(e, project.id)}
    >
      <div className="item-icon-wrapper project-wrapper">
        {icon ? (
          <img src={icon} alt="DAW" className="project-icon-img" />
        ) : (
          <div className="generic-icon"><Music size={32} /></div>
        )}
        {project.hasPreview && (
          <PreviewToggleButton
            className="item-preview-btn"
            iconSize={18}
            isPlaying={isPlaying}
            isLoading={ctx.loadingId === project.id}
            ariaLabel={isPlaying ? 'Stop preview' : 'Play preview'}
            onToggle={() => ctx.onTogglePreview(project)}
          />
        )}
      </div>
      <TilePlaybar ctx={ctx} id={project.id} />
      <span className="item-label">{project.name}</span>
      <span className="item-sublabel">{projectMetaLine(project)}</span>
      <TileTags tags={project.tags || []} tagColors={ctx.tagColors} />
    </div>
  );
}
