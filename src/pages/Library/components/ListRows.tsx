import { Music, AudioLines, Users } from 'lucide-react';
import { TagChip } from '@/components/ui/TagChip';
import type { Project, Folder, AudioItem } from '@/types/library';
import { audioExtLabel, formatListDate, getProjectIcon } from '../libraryDisplay';
import { FolderPeekTile, ItemPlaybar, PreviewToggleButton, folderPreviewTiles } from './ItemParts';
import {
  acceptDragOver, folderChildren, folderDragClasses, itemStateClasses,
  type LibraryItemContext,
} from './itemContext';

interface RowProps<T> { ctx: LibraryItemContext; item: T }

function RowPlaybar({ ctx, id }: { ctx: LibraryItemContext; id: string }) {
  return ctx.activeId === id ? <ItemPlaybar className="list-playbar" getElement={ctx.getAudioElement} /> : null;
}

function RowAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="list-actions">
      <button
        className="list-action-btn"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        {label}
      </button>
    </div>
  );
}

export function FolderRow({ ctx, item: folder }: RowProps<Folder>) {
  const { childProjects, childAudio } = folderChildren(ctx, folder.id);
  return (
    <div
      className={`list-row${folderDragClasses(ctx, folder.id)}`}
      draggable={true}
      onDragStart={(e) => ctx.onDragStart(e, 'folder', folder.id)}
      onDragEnter={() => ctx.onDragEnterItem(folder.id, 'folder')}
      onDragOver={acceptDragOver}
      onDragLeave={() => { if (ctx.dragOverFolderId === folder.id) ctx.setDragOverFolderId(null); }}
      onDrop={(e) => ctx.onDropOnFolder(e, folder.id)}
      onDragEnd={ctx.onDragEnd}
      onDoubleClick={() => ctx.onNavigateFolder(folder.id)}
      tabIndex={0}
      role="button"
      aria-label={`${folder.name}, folder`}
      onKeyDown={(e) => { if (e.key === 'Enter') ctx.onNavigateFolder(folder.id); }}
      onContextMenu={(e) => ctx.onFolderContextMenu(e, folder.id)}
    >
      <div className="list-icon folder-wrapper">
        <FolderPeekTile tiles={folderPreviewTiles(childProjects, childAudio)} iconSize={14} />
      </div>
      <span className="list-name">
        {folder.name}
        {!!ctx.sharedFolders[folder.id] && (
          <span className="shared-badge" title="Shared folder"><Users size={13} aria-hidden /> Shared</span>
        )}
      </span>
    </div>
  );
}

export function AudioRow({ ctx, item: audio }: RowProps<AudioItem>) {
  const isPlaying = ctx.playingId === audio.id;
  return (
    <div
      data-select-key={`audio:${audio.id}`}
      className={`list-row${itemStateClasses(ctx, 'audio', audio.id)}`}
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
      <div className="list-icon">
        <div className="list-icon-placeholder"><AudioLines size={28} /></div>
        <PreviewToggleButton
          className="list-preview-btn"
          iconSize={16}
          isPlaying={isPlaying}
          isLoading={ctx.loadingId === audio.id}
          ariaLabel={isPlaying ? 'Stop' : 'Play'}
          onToggle={() => ctx.onToggleAudio(audio)}
        />
      </div>
      <div className="list-name-stack">
        <span className="list-name">{audio.name}</span>
        <RowPlaybar ctx={ctx} id={audio.id} />
      </div>
      <div className="list-meta">
        <span className="list-meta-label">Audio</span>
        <span className="list-meta-value">{audioExtLabel(audio)}</span>
      </div>
      <RowAction label={isPlaying ? 'Stop' : 'Play'} onClick={() => ctx.onToggleAudio(audio)} />
    </div>
  );
}

function RowTags({ tags, tagColors }: { tags: string[]; tagColors: Record<string, string> }) {
  if (tags.length === 0) return null;
  return (
    <div className="list-tags">
      {tags.slice(0, 3).map(tag => (
        <TagChip key={tag} tag={tag} color={tagColors[tag]} />
      ))}
      {tags.length > 3 && (
        <span className="list-tags-more">+{tags.length - 3}</span>
      )}
    </div>
  );
}

export function ProjectRow({ ctx, item: project }: RowProps<Project>) {
  const isPlaying = ctx.playingId === project.id;
  const icon = getProjectIcon(project.daw);
  return (
    <div
      data-select-key={`project:${project.id}`}
      className={`list-row${itemStateClasses(ctx, 'project', project.id)}`}
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
      <div className="list-icon">
        {icon ? (
          <img src={icon} alt="DAW" className="list-icon-img" />
        ) : (
          <div className="list-icon-placeholder"><Music size={28} /></div>
        )}
        {project.hasPreview && (
          <PreviewToggleButton
            className="list-preview-btn"
            iconSize={16}
            isPlaying={isPlaying}
            isLoading={ctx.loadingId === project.id}
            ariaLabel={isPlaying ? 'Stop preview' : 'Play preview'}
            onToggle={() => ctx.onTogglePreview(project)}
          />
        )}
      </div>
      <div className="list-name-stack">
        <span className="list-name">{project.name}</span>
        <RowPlaybar ctx={ctx} id={project.id} />
      </div>
      <div className="list-meta">
        <span className="list-meta-label">Last saved</span>
        <span className="list-meta-value">
          {formatListDate(project.created_at)}
        </span>
      </div>
      <RowTags tags={project.tags || []} tagColors={ctx.tagColors} />
      <RowAction label="Open" onClick={() => ctx.onOpenProject(project.id, project.name)} />
    </div>
  );
}
