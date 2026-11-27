import { useState } from 'react';
import { Users, Headphones, RefreshCw, AlertCircle, Lock, OctagonX, PauseCircle } from 'lucide-react';
import { useSharing, roleLabel, relativeTime, hub, errorText } from '@/components/Sharing';
import type { SharedFolder } from '@/components/Sharing';
import { TransferBar } from '@/components/Sharing/TransferBar';
import './LibrarySidebar.css';

/** Why the folder offers Force stop, in a few words. */
const troubleText = {
  looping: 'Syncing keeps starting over',
  stuck: 'Syncing hasn’t moved for 2 minutes',
} as const;

/** Shown at the top of a shared folder: who's in it, how you take part, and whether it's up to date. */
export function SharedFolderBar({ folderId }: { folderId: string }) {
  const { folders, status, shareFolder, syncNow, forceStopSync } = useSharing();
  const shared = folders[folderId];
  if (!shared) return null;
  if (shared.accessClosed) return <ClosedFolderBar shared={shared} />;
  const st = status[folderId];
  const listening = shared.role === 'listen';
  const syncing = st?.state === 'syncing';
  const paused = st?.state === 'paused';
  const trouble = !paused ? st?.trouble : undefined;
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
        {listening ? ' · you can play previews' : ''}
        {' · '}
        {trouble ? (
          <span className="ui-status-error" role="alert"><AlertCircle size={12} aria-hidden /> {troubleText[trouble]}</span>
        ) : paused ? (
          <span><PauseCircle size={12} aria-hidden /> Sync stopped. Press Sync now to try again.</span>
        ) : syncing && st?.transfer ? <TransferBar transfer={st.transfer} /> : syncing ? (st?.message || 'Syncing…') : error ? (
          <span className="ui-status-error"><AlertCircle size={12} aria-hidden /> {error}</span>
        ) : `synced ${relativeTime(st?.lastSync ?? shared.lastSync)}`}
      </span>
      {trouble && (
        <button
          type="button"
          className="ui-btn ui-btn-sm ui-btn-danger"
          onClick={() => { void forceStopSync(folderId); }}
          title="Stop syncing this folder until you press Sync now. Nothing on this Mac or the server is deleted."
        >
          <OctagonX size={13} aria-hidden />
          Force stop
        </button>
      )}
      <button
        type="button"
        className="ui-btn ui-btn-sm"
        onClick={() => { void syncNow(folderId); }}
        disabled={syncing}
        title="Get everyone's latest versions and send yours"
      >
        <RefreshCw size={13} className={syncing ? 'animate-spin' : undefined} aria-hidden />
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
      <button type="button" className="ui-btn ui-btn-sm" onClick={() => shareFolder(folderId, shared.name)}>
        {shared.role === 'owner' ? 'Invite & manage' : 'People'}
      </button>
    </div>
  );
}

/**
 * The owner removed you or stopped sharing. Nothing was deleted: say so, and
 * offer the two ways on: a new code from the owner, or keeping the copies as a
 * normal folder.
 */
function ClosedFolderBar({ shared }: { shared: SharedFolder }) {
  const { join, refresh } = useSharing();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stopSyncing = async () => {
    setBusy(true); setError('');
    try {
      await hub.leave(shared.folderId);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shared-folder-bar is-closed" role="region" aria-label="Shared folder">
      <Lock size={16} aria-hidden />
      <span className="sfb-meta">
        <strong>Access to “{shared.name}” was closed.</strong> Your copies are still on this Mac.
        {error && <span className="ui-status-error" role="alert"> {error}</span>}
      </span>
      <button type="button" className="ui-btn ui-btn-sm ui-btn-primary" onClick={() => join()} disabled={busy}>
        Enter a new code
      </button>
      <button
        type="button"
        className="ui-btn ui-btn-sm"
        onClick={() => { void stopSyncing(); }}
        disabled={busy}
        title="Keep the folder and your copies as a normal Library folder"
      >
        Stop syncing this folder
      </button>
    </div>
  );
}
