import type React from 'react';
import { Music, ArrowUpRight, FileMusic, X } from 'lucide-react';
import type { PlaybackStatus } from '@/hooks/useLibraryPreview';
import { getProjectIcon } from '../libraryDisplay';
import type { RecentlySavedProject } from '../hooks/useRecentlySaved';

interface DropOverlaysProps {
  isFileDragging: boolean;
  dropError: string | null;
  onDismissError: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/** Full-page "Drop to add" overlay while dragging files in, and the error after a bad drop. */
export function DropOverlays(p: DropOverlaysProps) {
  return (
    <>
      {p.isFileDragging && (
        <div
          className="library-drop-overlay"
          onDragOver={p.onDragOver}
          onDragLeave={p.onDragLeave}
          onDrop={p.onDrop}
        >
          <div className="library-drop-overlay-inner">
            <FileMusic size={48} />
            <span className="library-drop-title">Drop to add</span>
            <span className="library-drop-sub">A DAW project, or an audio file (WAV, MP3, AIFF, FLAC, M4A)</span>
          </div>
        </div>
      )}
      {p.dropError && !p.isFileDragging && (
        <div
          className="library-drop-overlay library-drop-overlay--error"
          onClick={p.onDismissError}
        >
          <div className="library-drop-overlay-inner">
            <X size={48} />
            <span className="library-drop-title">{p.dropError}</span>
            <span className="library-drop-sub">Drop a DAW project, or an audio file (WAV, MP3, AIFF, FLAC, M4A)</span>
          </div>
        </div>
      )}
    </>
  );
}

interface RecentlySavedToastProps {
  project: RecentlySavedProject;
  onOpen: () => void;
  onDismiss: () => void;
}

/** "Recently saved X — Open" card at the top of the root folder. */
export function RecentlySavedToast({ project, onOpen, onDismiss }: RecentlySavedToastProps) {
  const icon = getProjectIcon(project.daw);
  return (
    <div className="recently-saved-toast" onClick={onOpen}>
      <div className="recent-toast-artwork">
        {icon ? (
          <img src={icon} alt="DAW" />
        ) : (
          <Music size={18} />
        )}
      </div>
      <div className="recent-toast-info">
        <span className="recent-toast-title">
          Recently saved <strong>{project.name}</strong>
        </span>
        <span className="recent-toast-time">
          {new Date(project.latestModTime || '').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>
      <div className="recent-toast-open">
        Open
        <ArrowUpRight size={14} />
      </div>
      <button
        className="recent-toast-dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface PlaybackToastProps {
  status: PlaybackStatus;
  onRetry: () => void;
  onDismiss: () => void;
}

/** Playback failure / fallback notice. */
export function PlaybackToast({ status, onRetry, onDismiss }: PlaybackToastProps) {
  return (
    <div
      className={`playback-toast playback-toast--${status.kind}`}
      role={status.kind === 'error' ? 'alert' : 'status'}
    >
      <span className="playback-toast__text">{status.text}</span>
      {status.canRetry && (
        <button className="playback-toast__action" onClick={onRetry}>Retry</button>
      )}
      <button className="playback-toast__close" onClick={onDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
