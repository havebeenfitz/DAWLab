import { Folder as FolderIcon, Library as LibraryIcon, Users, Headphones, LogIn, Settings as SettingsIcon, Loader2, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Folder } from '@/types/library';
import { useSharing } from '@/components/Sharing';
import './LibrarySidebar.css';

interface Props {
  folders: Folder[];
  currentFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
}

/** Where things are: all projects, your folders, and folders shared with or by you. */
export function LibrarySidebar({ folders, currentFolderId, onNavigate }: Props) {
  const navigate = useNavigate();
  const { folders: shared, status, join } = useSharing();
  const byPosition = (a: Folder, b: Folder) => (a.position ?? 0) - (b.position ?? 0);
  const own = folders.filter((f) => f.parentId === null && !shared[f.id]).sort(byPosition);
  const sharedFolders = folders.filter((f) => shared[f.id]).sort(byPosition);
  // The folder you're in, or the top-level folder it sits in, stays highlighted.
  const activeTop = topLevelOf(folders, currentFolderId);

  return (
    <nav className="lib-sidebar" aria-label="Library sections">
      <div className="lib-sidebar-section">
        <button
          type="button"
          className={`lib-sidebar-item ${currentFolderId === null ? 'is-active' : ''}`}
          onClick={() => onNavigate(null)}
          aria-current={currentFolderId === null ? 'page' : undefined}
        >
          <LibraryIcon size={15} aria-hidden /> <span>All projects</span>
        </button>
      </div>

      {own.length > 0 && (
        <div className="lib-sidebar-section">
          <div className="lib-sidebar-heading">My folders</div>
          {own.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`lib-sidebar-item ${activeTop === f.id || currentFolderId === f.id ? 'is-active' : ''}`}
              onClick={() => onNavigate(f.id)}
            >
              <FolderIcon size={15} aria-hidden /> <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="lib-sidebar-section">
        <div className="lib-sidebar-heading">Shared</div>
        {sharedFolders.length === 0 && (
          <p className="lib-sidebar-empty">Right-click a folder and choose Share to work on it with others.</p>
        )}
        {sharedFolders.map((f) => {
          const s = shared[f.id];
          const st = status[f.id];
          const listening = s.role === 'listen';
          const state = st?.state ?? (s.lastError ? 'error' : 'synced');
          return (
            <button
              key={f.id}
              type="button"
              className={`lib-sidebar-item ${activeTop === f.id || currentFolderId === f.id ? 'is-active' : ''}`}
              onClick={() => onNavigate(f.id)}
              title={`${f.name} · ${listening ? 'listener' : s.role === 'owner' ? 'you share it' : 'collaborator'}`}
            >
              {listening ? <Headphones size={15} aria-hidden /> : <Users size={15} aria-hidden />}
              <span>{f.name}</span>
              <span className="lib-sidebar-meta">
                {state === 'syncing' && <Loader2 size={12} className="animate-spin" aria-label="Syncing" />}
                {state === 'error' && <AlertCircle size={12} className="lib-sidebar-error" aria-label="Sync problem" />}
                {state === 'synced' && s.members.length > 1 && <span aria-label={`${s.members.length} people`}>{s.members.length}</span>}
              </span>
            </button>
          );
        })}
        <button type="button" className="lib-sidebar-item lib-sidebar-action" onClick={() => join()}>
          <LogIn size={15} aria-hidden /> <span>Join shared folder…</span>
        </button>
      </div>

      <div className="lib-sidebar-footer">
        <button type="button" className="lib-sidebar-item" onClick={() => navigate('/settings')}>
          <SettingsIcon size={15} aria-hidden /> <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}

function topLevelOf(folders: Folder[], id: string | null): string | null {
  let current = id ? folders.find((f) => f.id === id) : undefined;
  while (current?.parentId) current = folders.find((f) => f.id === current!.parentId);
  return current?.id ?? null;
}
