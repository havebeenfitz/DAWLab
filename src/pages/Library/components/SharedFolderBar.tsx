import { Users, Headphones, RefreshCw, AlertCircle } from 'lucide-react';
import { useSharing, roleLabel, relativeTime } from '@/components/Sharing';
import './LibrarySidebar.css';

/** Shown at the top of a shared folder: who's in it, how you take part, and whether it's up to date. */
export function SharedFolderBar({ folderId }: { folderId: string }) {
  const { folders, status, shareFolder } = useSharing();
  const shared = folders[folderId];
  if (!shared) return null;
  const st = status[folderId];
  const listening = shared.role === 'listen';
  const syncing = st?.state === 'syncing';
  const error = st?.state === 'error' ? st.error : !st ? shared.lastError : undefined;

  return (
    <div className="shared-folder-bar" role="region" aria-label="Shared folder">
      {listening ? <Headphones size={16} aria-hidden /> : <Users size={16} aria-hidden />}
      <strong>{shared.name}</strong>
      <span className="sfb-avatars" aria-label={`${shared.members.length} people`}>
        {shared.members.slice(0, 5).map((m) => <span key={m.id} title={`${m.name} · ${roleLabel[m.role]}`}>{m.name.slice(0, 1).toUpperCase()}</span>)}
      </span>
      <span className="sfb-meta">
        {roleLabel[shared.role]}
        {listening ? ' · you can play previews and comment' : ''}
        {' · '}
        {syncing ? (st?.message || 'Syncing…') : error ? (
          <span className="ui-status-error"><AlertCircle size={12} aria-hidden /> {error}</span>
        ) : `synced ${relativeTime(st?.lastSync ?? shared.lastSync)}`}
      </span>
      <button type="button" className="ui-btn ui-btn-sm" onClick={() => shareFolder(folderId, shared.name)}>
        {syncing ? <RefreshCw size={13} className="animate-spin" aria-hidden /> : null}
        {shared.role === 'owner' ? 'Invite & manage' : 'People'}
      </button>
    </div>
  );
}
