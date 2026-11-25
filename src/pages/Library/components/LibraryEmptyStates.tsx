import { Plus, Search, FileMusic } from 'lucide-react';

/** Shown in a folder (or the root) with nothing in it. */
export function EmptyFolderState({ inFolder, onNewProject }: { inFolder: boolean; onNewProject: () => void }) {
  return (
    <div className="empty-state-content">
      <FileMusic size={32} className="empty-state-icon" />
      <h3 className="empty-state-title">
        {inFolder ? 'This folder is empty' : 'Start your first project'}
      </h3>
      <p className="empty-state-subtitle">
        {inFolder
          ? 'Drag a project or audio file in, or create a new one right here.'
          : 'Bring in a Logic, Ableton, FL Studio, Reaper, or Pro Tools project to start tracking every version — or drop in a bounce or reference to audition.'}
      </p>
      <button className="empty-state-cta" onClick={onNewProject}>
        <Plus size={16} />
        New Project
      </button>
    </div>
  );
}

/** Shown when the search or filters leave nothing visible. */
export function NoMatchesState({ query }: { query: string }) {
  return (
    <div className="empty-state-content">
      <Search size={32} className="empty-state-icon" />
      <h3 className="empty-state-title">No matches</h3>
      <p className="empty-state-subtitle">
        {query
          ? `Nothing matches “${query}”.`
          : 'No projects match the active filters.'}
      </p>
    </div>
  );
}
