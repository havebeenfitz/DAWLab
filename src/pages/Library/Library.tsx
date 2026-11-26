/**
 * Library.tsx
 *
 * The home screen: folders, projects and imported audio in a grid or list,
 * with search, facet filters, drag-to-reorder/move, selection + Quick Look.
 *
 * State and actions live in ./hooks, presentational pieces in ./components.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './Library.css';
import { Loader2 } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { ContextMenu } from '@/components/ContextMenu';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { NewProject } from '@/components/NewProject';
import { ActivityPanel } from '@/components/ActivityPanel';
import { TagManagerPopover } from '@/components/TagManagerPopover/TagManagerPopover';
import { useLibraryPreview } from '@/hooks/useLibraryPreview';
import { FolderPeek } from '@/components/FolderPeek';
import { DitherGradient, EMPTY_LIBRARY_DITHER } from '@/components/ui/DitherGradient';
import { FoundProjectsBanner, FoundProjectsPanel } from '@/components/FoundProjects';
import { useSharing } from '@/components/Sharing';
import { LibrarySidebar } from './components/LibrarySidebar';
import { SharedFolderBar } from './components/SharedFolderBar';
import { LibraryHeader } from './components/LibraryHeader';
import { LibraryItems } from './components/LibraryItems';
import type { LibraryItemContext } from './components/itemContext';
import { DropOverlays, RecentlySavedToast, PlaybackToast } from './components/LibraryNotices';
import { ActiveFiltersBar, BreadcrumbBar } from './components/LibraryNavBars';
import { EmptyFolderState, NoMatchesState } from './components/LibraryEmptyStates';
import { ProjectQuickLook, AudioQuickLook } from './components/LibraryQuickLook';
import { LibraryModals } from './components/LibraryModals';
import { getProjectIcon } from './libraryDisplay';
import {
  buildAudioMenuItems, buildEmptyMenuItems, buildFolderMenuItems, buildProjectMenuItems,
  type LibraryContextMenuState,
} from './contextMenuItems';
import { useLibraryData } from './hooks/useLibraryData';
import { useRecentlySaved } from './hooks/useRecentlySaved';
import { useFoundProjects } from './hooks/useFoundProjects';
import { useCurrentFolder, useFolderPeek, buildBreadcrumbs } from './hooks/useFolderNavigation';
import { useLibraryFilters } from './hooks/useLibraryFilters';
import { useViewOrder } from './hooks/useViewOrder';
import { useLibrarySelection } from './hooks/useLibrarySelection';
import { useLibraryDragDrop } from './hooks/useLibraryDragDrop';
import { useNewProjectModal, useOsFileDrop } from './hooks/useOsFileDrop';
import { useFolderActions } from './hooks/useFolderActions';
import { useAudioActions } from './hooks/useAudioActions';
import { useProjectTags } from './hooks/useProjectTags';
import { useArchiveProjects } from './hooks/useArchiveProjects';
import { SelectionBar } from './components/SelectionBar';
import { useRemoveFromLibrary, REMOVE_WARNING, planFolderRemoval, planProjectRemoval, isInSharedFolder } from './hooks/useRemoveFromLibrary';
import { WarningModal } from '@/components/WarningModal/WarningModal';
import { useDeleteFromServer } from './hooks/useDeleteFromServer';

const VIEW_MODE_KEY = 'dawlab-library-view-mode';

/** Opens a context menu of `type` at the pointer (for an item, without bubbling). */
const menuAt = (e: React.MouseEvent, menu: Omit<LibraryContextMenuState, 'x' | 'y'>): LibraryContextMenuState => {
  e.preventDefault();
  e.stopPropagation();
  return { x: e.clientX, y: e.clientY, ...menu };
};

export const Library: React.FC = () => {
  const navigate = useNavigate();
  const sharing = useSharing();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem(VIEW_MODE_KEY) as 'grid' | 'list') || 'grid';
  });
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  const data = useLibraryData();
  const { projects, folders, audioItems, loading, loadMyProjects } = data;

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<LibraryContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const closeContextMenu = () => setContextMenu(null);

  const recent = useRecentlySaved(data.rawProjectsRef);
  const found = useFoundProjects();
  const tags = useProjectTags(projects, data.setProjects);
  const newProject = useNewProjectModal();

  // Inline audio preview (single shared player, one item at a time — projects and
  // imported audio share the same element, so only one ever plays).
  const preview = useLibraryPreview();
  const { playingId, loadingId, toggleAudio, stop: stopPreview } = preview;

  const { currentFolderId, setCurrentFolderId } = useCurrentFolder(loading, folders, stopPreview);
  const folderPeek = useFolderPeek(setCurrentFolderId);
  const filters = useLibraryFilters({ projects, folders, audioItems, currentFolderId });
  const { normalizedQuery, activeFacets, currentListFolders, currentListProjects, currentListAudio } = filters;
  const order = useViewOrder({
    loading, currentFolderId,
    folders, setFolders: data.setFolders,
    projects, setProjects: data.setProjects,
    audioItems, setAudioItems: data.setAudioItems,
    activeFacets, normalizedQuery,
    searchedFolders: filters.searchedFolders,
    searchedProjects: filters.searchedProjects,
    searchedAudioItems: filters.searchedAudioItems,
  });
  const folderActions = useFolderActions({ folders, setFolders: data.setFolders, projects, audioItems, currentFolderId });
  const audioActions = useAudioActions({
    audioItems, setAudioItems: data.setAudioItems, currentFolderId, loadMyProjects,
    playingId, stopPreview, closeAddMenu: () => setShowAddMenu(false),
  });
  const removal = useRemoveFromLibrary({ setFolders: data.setFolders, audioItems, reload: loadMyProjects });
  const archiving = useArchiveProjects({ folders, setFolders: data.setFolders, reload: loadMyProjects });
  const deleteFromServer = useDeleteFromServer(loadMyProjects);

  const overlaysOpen =
    folderActions.showNewFolderModal || newProject.showNewProjectModal || folderActions.showRenameModal ||
    audioActions.showAudioRenameModal || folderActions.showDeleteConfirm || !!removal.plan || found.showFoundPanel ||
    showAddMenu || showFilterMenu || !!contextMenu || !!tags.tagPopover || !!folderPeek.peek || !!newProject.dropInit;

  const selection = useLibrarySelection({
    viewOrder: order.viewOrder, overlaysOpen, projects, audioItems,
    playPreview: preview.play, playAudio: preview.playAudio,
  });
  const drag = useLibraryDragDrop({
    selection: selection.selection, setSelection: selection.setSelection,
    viewOrder: order.viewOrder, setViewOrder: order.setViewOrder,
    folders, setFolders: data.setFolders, setProjects: data.setProjects, setAudioItems: data.setAudioItems,
  });
  const fileDrop = useOsFileDrop({
    isInternalDrag: !!drag.draggedItem, currentFolderId, loadMyProjects, openNewProject: newProject.openNewProject,
  });

  // Initial Load
  useEffect(() => {
    const init = async () => {
      data.setLoading(true);
      await loadMyProjects();
      data.setLoading(false);
      recent.checkRecentlySaved();
      found.detectNewProjects();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useClickOutside(contextMenuRef, useCallback(() => setContextMenu(null), []), !!contextMenu);
  useClickOutside(addMenuRef, useCallback(() => setShowAddMenu(false), []), showAddMenu);
  useClickOutside(filterMenuRef, useCallback(() => setShowFilterMenu(false), []), showFilterMenu);

  // Sharing changes the Library from outside this page (joining, new projects from others).
  useEffect(() => {
    const onChange = (e: Event) => {
      const folderId = (e as CustomEvent<{ folderId?: string }>).detail?.folderId;
      loadMyProjects();
      if (folderId) setCurrentFolderId(folderId);
    };
    window.addEventListener('dawlab:library-changed', onChange);
    return () => window.removeEventListener('dawlab:library-changed', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProject = (id: string, name: string) => {
    navigate(`/history/${id}`, { state: { projectName: name } });
  };

  const openRecentlySaved = () => {
    if (recent.recentlySavedProject) {
      recent.markRecentlySavedHandled();
      openProject(recent.recentlySavedProject.id, recent.recentlySavedProject.name);
    }
  };

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    // Only show if the click target is the content area itself, not a child item
    const target = e.target as HTMLElement;
    if (target.closest('.library-item') || target.closest('.list-row') || target.closest('.recently-saved-card')) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'empty' });
  };

  const getContextMenuItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const close = closeContextMenu;
    if (contextMenu.type === 'folder') {
      const folderId = contextMenu.folderId!;
      const folder = folders.find(f => f.id === folderId);
      return buildFolderMenuItems({
        isShared: Boolean(sharing.folders[folderId]),
        close,
        share: () => { if (folder) sharing.shareFolder(folder.id, folder.name); },
        syncNow: sharing.folders[folderId] && sharing.status[folderId]?.state !== 'syncing' ? () => { void sharing.syncNow(folderId); } : undefined,
        rename: () => folderActions.initiateRename(folderId),
        remove: () => { folderActions.initiateDelete(folderId); },
        removeFromLibrary: isInSharedFolder(folders, folderId, sharing.folders)
          ? undefined
          : () => void removal.request(planFolderRemoval(folders, projects, folderId)),
      });
    }
    if (contextMenu.type === 'project') {
      const project = projects.find(p => p.id === contextMenu.projectId);
      return buildProjectMenuItems({
        close,
        open: () => { if (project) openProject(project.id, project.name); },
        share: () => { if (project) sharing.shareProject(project.name); },
        manageTags: () => tags.setTagPopover({ x: contextMenu.x, y: contextMenu.y, projectId: contextMenu.projectId! }),
        ...(() => {
          const plan = planProjectRemoval(projects, contextMenu.projectId!, selection.selection.keys);
          if (!plan) return {};
          const local = plan.projects.filter(p => !isInSharedFolder(folders, p.folderId, sharing.folders));
          if (local.length === 0) return {};
          const finalPlan = local.length === plan.projects.length ? plan
            : { ...plan, projects: local, title: local.length === 1 ? `"${local[0].name}"` : `${local.length} projects` };
          return { removeCount: local.length, removeFromLibrary: () => { void removal.request(finalPlan); } };
        })(),
        deleteFromServer: (() => { const run = deleteFromServer(project); return run && (() => { void run(); }); })(),
      });
    }
    if (contextMenu.type === 'audio') {
      const audioId = contextMenu.audioId!;
      return buildAudioMenuItems({
        isPlaying: playingId === audioId,
        close,
        togglePlay: () => {
          const a = audioItems.find(x => x.id === audioId);
          if (a) toggleAudio(a);
        },
        rename: () => audioActions.initiateAudioRename(audioId),
        remove: () => audioActions.handleDeleteAudio(audioId),
      });
    }
    return buildEmptyMenuItems({
      close,
      newProject: () => newProject.openNewProject(),
      newFolder: () => folderActions.setShowNewFolderModal(true),
      addAudio: audioActions.handleAddAudio,
    });
  };

  /** Drop on the container or an item: persist the reordered view. */
  const finishReorderDrop = () => { order.saveViewOrder(); drag.setDraggedItem(null); };

  const itemContext: LibraryItemContext = {
    folders, projects, audioItems,
    tagColors: tags.tagColors,
    sharedFolders: sharing.folders,
    selectionKeys: selection.selection.keys,
    draggedItem: drag.draggedItem,
    dragOverFolderId: drag.dragOverFolderId,
    setDragOverFolderId: drag.setDragOverFolderId,
    isBeingDragged: drag.isBeingDragged,
    onDragStart: drag.handleDragStart,
    onDragEnterItem: drag.handleDragEnterItem,
    onDropOnFolder: drag.handleDropOnFolder,
    onDropOnItem: (e) => { e.stopPropagation(); e.preventDefault(); finishReorderDrop(); },
    onDragEnd: drag.handleDragEnd,
    playingId, loadingId,
    activeId: preview.activeId,
    getAudioElement: preview.getElement,
    onToggleAudio: toggleAudio,
    onTogglePreview: preview.toggle,
    onItemSelect: selection.handleItemSelect,
    onFolderClick: folderPeek.handleFolderClick,
    onEnterFolder: folderPeek.enterFolder,
    onNavigateFolder: setCurrentFolderId,
    onOpenProject: openProject,
    onFolderContextMenu: (e, folderId) => setContextMenu(menuAt(e, { type: 'folder', folderId })),
    onProjectContextMenu: (e, projectId) => setContextMenu(menuAt(e, { type: 'project', projectId })),
    onAudioContextMenu: (e, audioId) => setContextMenu(menuAt(e, { type: 'audio', audioId })),
  };

  const isCurrentFolderEmpty = currentListFolders.length === 0 && currentListProjects.length === 0 && currentListAudio.length === 0;
  const isLibraryEmpty = !loading && isCurrentFolderEmpty;
  const isFiltering = normalizedQuery !== '' || activeFacets.size > 0;
  const { recentlySavedProject } = recent;
  const { peek } = folderPeek;
  const tagPopoverProject = tags.tagPopover ? projects.find(p => p.id === tags.tagPopover!.projectId) : undefined;
  const peekFolder = peek ? folders.find(f => f.id === peek.folderId) : undefined;

  return (
    <div className="library-shell">
    <LibrarySidebar folders={folders} currentFolderId={currentFolderId} onNavigate={setCurrentFolderId} />
    <div
      className="library-container"
      onDragEnter={fileDrop.handleFileDragEnter}
      onDragOver={fileDrop.handleFileDragOver}
      onDragLeave={fileDrop.handleFileDragLeave}
      onDrop={fileDrop.handleFileDrop}
    >
      <DropOverlays
        isFileDragging={fileDrop.isFileDragging}
        dropError={fileDrop.dropError}
        onDismissError={fileDrop.clearDropError}
        onDragOver={fileDrop.handleFileDragOver}
        onDragLeave={fileDrop.handleFileDragLeave}
        onDrop={fileDrop.handleFileDrop}
      />
      {isLibraryEmpty && (
        <div className="empty-state-backdrop">
          <DitherGradient {...EMPTY_LIBRARY_DITHER} />
        </div>
      )}
      <LibraryHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filters={filters}
        tagColors={tags.tagColors}
        showFilterMenu={showFilterMenu}
        onToggleFilterMenu={() => setShowFilterMenu(prev => !prev)}
        filterMenuRef={filterMenuRef}
        addMenu={{
          open: showAddMenu,
          onToggle: () => setShowAddMenu(!showAddMenu),
          menuRef: addMenuRef,
          onNewProject: () => { newProject.openNewProject(); setShowAddMenu(false); },
          onNewFolder: () => { folderActions.setShowNewFolderModal(true); setShowAddMenu(false); },
          onAddAudio: audioActions.handleAddAudio,
          onJoinShared: () => { sharing.join(); setShowAddMenu(false); },
        }}
      />

      {/* Main Content */}
      <main
        ref={selection.contentRef}
        className="library-content"
        onMouseDown={selection.onMarqueeMouseDown}
        onClick={selection.handleGridBackgroundClick}
        onContextMenu={handleEmptyContextMenu}
      >
        {selection.marquee && <div className="marquee-selection" style={selection.marquee} />}

        {recentlySavedProject && !currentFolderId && !recent.recentlySavedDismissed && (
          <RecentlySavedToast
            project={recentlySavedProject}
            onOpen={openRecentlySaved}
            onDismiss={recent.dismissRecentlySaved}
          />
        )}

        {found.foundProjects.length > 0 && !currentFolderId && !found.foundDismissed && (
          <FoundProjectsBanner
            count={found.foundProjects.length}
            onReview={() => found.setShowFoundPanel(true)}
            onDismiss={() => found.setFoundDismissed(true)}
          />
        )}

        <section className="content-grid-wrapper">
          <ActiveFiltersBar
            facets={filters.activeFacetList}
            tagColors={tags.tagColors}
            onToggle={filters.toggleFacet}
            onClearAll={filters.clearFacets}
          />
          {currentFolderId && (
            <BreadcrumbBar
              crumbs={buildBreadcrumbs(folders, currentFolderId).slice(1)}
              onNavigate={setCurrentFolderId}
              onDropOnCrumb={(folderId) => { drag.moveDraggedTo(folderId); drag.setDraggedItem(null); }}
            />
          )}

          {currentFolderId && sharing.folders[currentFolderId] && <SharedFolderBar folderId={currentFolderId} />}

          {loading ? (
             <div className="loading-state"><Loader2 className="animate-spin" /> Loading...</div>
          ) : (
             <div
               className={`items-container ${viewMode}`}
               onDragOver={(e) => e.preventDefault()}
               onDrop={(e) => { e.preventDefault(); finishReorderDrop(); }}
             >
                <LibraryItems viewMode={viewMode} viewOrder={order.viewOrder} ctx={itemContext} />

                {!isFiltering && isCurrentFolderEmpty && (
                  <EmptyFolderState inFolder={!!currentFolderId} onNewProject={() => newProject.openNewProject()} />
                )}

                {isFiltering && order.viewOrder.length === 0 && (
                  <NoMatchesState query={normalizedQuery ? filters.searchQuery.trim() : ''} />
                )}
             </div>
          )}

          {(() => {
            const keys = selection.selection.keys;
            const chosen = projects.filter(p => keys.has(`project:${p.id}`));
            const local = chosen.filter(p => !isInSharedFolder(folders, p.folderId, sharing.folders));
            const projectKeys = order.viewOrder.filter(i => i.kind === 'project').map(i => `project:${i.id}`);
            return (
              <SelectionBar
                count={chosen.length}
                actionable={local.length}
                busy={archiving.busy || removal.busy}
                allSelected={projectKeys.every(k => keys.has(k))}
                onSelectAll={() => selection.setSelection({ keys: new Set(projectKeys), anchor: projectKeys[0] ?? null, focus: projectKeys[projectKeys.length - 1] ?? null })}
                onArchive={() => { void archiving.archive(local); }}
                onRemove={() => { void removal.request({ title: local.length === 1 ? `"${local[0].name}"` : `${local.length} projects`, projects: local, folderIds: [] }); }}
                onClear={() => selection.setSelection({ keys: new Set(), anchor: null, focus: null })}
              />
            );
          })()}
        </section>
      </main>

      {/* Bottom Bar */}
      <footer className="library-footer">
        {/* Settings moved to the sidebar */}
        <div className="footer-left" />

        <div className="footer-right">
           <ActivityPanel embedded={true} />
        </div>
      </footer>

      {contextMenu && (
        <ContextMenu
          ref={contextMenuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
        />
      )}

      {tags.tagPopover && (
        <TagManagerPopover
          x={tags.tagPopover.x}
          y={tags.tagPopover.y}
          tags={tagPopoverProject?.tags || []}
          tagColors={tags.tagColors}
          suggestions={tags.tagSuggestions}
          onAddTag={(tag, color) => tags.handleTagPopoverAdd(tags.tagPopover!.projectId, tag, color)}
          onRemoveTag={(tag) => tags.handleTagPopoverRemove(tags.tagPopover!.projectId, tag)}
          onClose={() => tags.setTagPopover(null)}
        />
      )}

      {/* Folder Peek (iOS-style in-place preview) */}
      {peek && peekFolder && (
        <FolderPeek
          folder={peekFolder}
          projects={projects.filter(p => p.folderId === peek.folderId)}
          subfolders={folders.filter(f => f.parentId === peek.folderId)}
          audioItems={audioItems.filter(a => a.folderId === peek.folderId)}
          getIcon={getProjectIcon}
          anchorRect={peek.rect}
          onOpenProject={(id, name) => { folderPeek.closePeek(); openProject(id, name); }}
          onEnterFolder={folderPeek.enterFolder}
          onEnterSubfolder={folderPeek.enterFolder}
          onPlayAudio={(item) => { folderPeek.closePeek(); toggleAudio(item); }}
          onClose={folderPeek.closePeek}
        />
      )}

      <NewProject
        isOpen={newProject.showNewProjectModal}
        initialPath={newProject.dropInit?.path}
        initialName={newProject.dropInit?.name}
        initialDaw={newProject.dropInit?.daw}
        onClose={newProject.closeNewProject}
        onSuccess={(projectId?: string) => {
          // A project created while browsing inside a folder should land in that
          // folder. Drops capture their own target (dropInit.folderId); the
          // New Project button/menu/empty-state flows fall back to the folder the
          // library is currently showing.
          const targetFolderId = newProject.dropInit?.folderId ?? currentFolderId;
          newProject.closeNewProject();
          if (targetFolderId && projectId) {
            window.ipcRenderer
              .invoke('move-project-to-folder', projectId, targetFolderId)
              .catch(() => {})
              .finally(() => loadMyProjects());
          } else {
            loadMyProjects();
          }
        }}
      />

      {/* Quick Look: Space on a selected project or audio item */}
      {selection.quickLookProject && (
        <ProjectQuickLook
          project={selection.quickLookProject}
          play={preview.play}
          playingId={playingId}
          loadingId={loadingId}
          pause={preview.pause}
          onSeek={preview.seek}
          getElement={preview.getElement}
          onClose={selection.closeQuickLook}
        />
      )}
      {selection.quickLookAudio && (
        <AudioQuickLook
          audio={selection.quickLookAudio}
          play={preview.playAudio}
          playingId={playingId}
          loadingId={loadingId}
          pause={preview.pause}
          onSeek={preview.seek}
          getElement={preview.getElement}
          onClose={selection.closeQuickLook}
        />
      )}

      {preview.status && (
        <PlaybackToast status={preview.status} onRetry={preview.retry} onDismiss={preview.dismissStatus} />
      )}

      {found.showFoundPanel && (
        <FoundProjectsPanel
          projects={found.foundProjects}
          onClose={() => found.setShowFoundPanel(false)}
          onRemove={found.removeFoundProject}
          onAdded={loadMyProjects}
        />
      )}

      <LibraryModals folderActions={folderActions} audioActions={audioActions} />
      <WarningModal
        isOpen={!!removal.plan}
        title="Remove from DAWLab"
        warningType={REMOVE_WARNING}
        message={removal.plan ? (
          <>
            <p>Remove {removal.plan.title}{removal.plan.folderIds.length ? ` and its ${removal.plan.projects.length} project${removal.plan.projects.length === 1 ? '' : 's'}` : ''} from DAWLab?</p>
            <p>The project files stay on your disk. Their saved versions in DAWLab are deleted, and DAWLab stops suggesting them.</p>
          </>
        ) : ''}
        actions={[
          { label: 'Cancel', onClick: removal.cancel, variant: 'cancel' },
          { label: removal.busy ? 'Removing…' : 'Remove', onClick: () => { void removal.confirm(); }, variant: 'destructive' },
        ]}
        onCancel={removal.cancel}
      />
    </div>
    </div>
  );
};
