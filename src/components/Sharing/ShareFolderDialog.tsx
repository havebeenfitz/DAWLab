import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, Link2, RefreshCw, UserMinus } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import {
  hub, errorText, onHubProgress, relativeTime, roleHint, roleLabel,
  type CreatedInvite, type InviteInfo, type InviteRole, type SharedFolder, type SpaceDetails, type SyncStatus,
} from './hub';
import './Sharing.css';

interface Props {
  target: { folderId: string; folderName: string } | null;
  shared: SharedFolder | null;
  syncStatus?: SyncStatus;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

type Confirming = null | 'stop' | 'leave' | { removeMemberId: string; name: string };

/** Share a Library folder, invite people to it, and manage who has access. */
export function ShareFolderDialog({ target, shared, syncStatus, onClose, onChanged }: Props) {
  const open = target !== null;
  const folderId = target?.folderId ?? '';
  const [details, setDetails] = useState<SpaceDetails | null>(null);
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [storage, setStorage] = useState<{ totalBytes: number | null; freeBytes: number | null } | null>(null);
  const [server, setServer] = useState<{ hubUrl: string; hasKey: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('edit');
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);

  const isOwner = shared?.role === 'owner';

  const load = useCallback(async () => {
    if (!folderId) return;
    setError('');
    if (!shared) {
      setDetails(null);
      hub.getSettings().then(setServer).catch(() => setServer(null));
      return;
    }
    try {
      const d = await hub.details(folderId);
      setDetails(d);
      if (d.me.role === 'owner') {
        setInvites(await hub.listInvites(folderId));
        hub.serverStorage(folderId).then(setStorage).catch(() => setStorage(null));
      }
    } catch (err) {
      setError(errorText(err));
    }
  }, [folderId, shared]);

  useEffect(() => {
    if (!open) return;
    setCreated(null); setConfirming(null); setProgress(''); setInviteRole('edit');
    load();
  }, [open, load]);

  useEffect(() => (open ? onHubProgress(folderId, setProgress) : undefined), [open, folderId]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false); setProgress('');
    }
  };

  const startSharing = () => run(async () => {
    await hub.shareFolder(folderId);
    await onChanged();
  });

  const createInvite = () => run(async () => {
    setCreated(await hub.createInvite(folderId, inviteRole));
    setInvites(await hub.listInvites(folderId));
  });

  const revoke = (inviteId: string) => run(async () => {
    await hub.revokeInvite(folderId, inviteId);
    setInvites(await hub.listInvites(folderId));
    if (created?.id === inviteId) setCreated(null);
  });

  const changeRole = (memberId: string, role: InviteRole) => run(async () => {
    await hub.changeRole(folderId, memberId, role);
    await load();
  });

  const confirmAction = () => run(async () => {
    if (confirming === 'stop') await hub.stopSharing(folderId);
    else if (confirming === 'leave') await hub.leave(folderId);
    else if (confirming) await hub.removeMember(folderId, confirming.removeMemberId);
    const closes = confirming === 'stop' || confirming === 'leave';
    setConfirming(null);
    await onChanged();
    if (closes) onClose(); else await load();
  });

  const syncNow = () => run(async () => { await hub.syncFolder(folderId); await onChanged(); await load(); });

  const name = details?.space.name ?? shared?.name ?? target?.folderName ?? '';
  const syncing = syncStatus?.state === 'syncing';

  return (
    <Dialog
      open={open}
      title={shared ? `“${name}” is shared` : `Share “${name}”`}
      subtitle={shared
        ? `${roleLabel[shared.role]} · ${(details?.members ?? shared.members).length || 1} ${((details?.members ?? shared.members).length || 1) === 1 ? 'person' : 'people'}`
        : 'Everyone you invite gets this folder and every project in it, inside DAWLab.'}
      onClose={onClose}
      busy={busy}
      width="md"
      footer={shared ? (
        confirming ? (
          <ConfirmBar confirming={confirming} name={name} busy={busy} onCancel={() => setConfirming(null)} onConfirm={confirmAction} />
        ) : (
          <>
            {isOwner
              ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-danger" onClick={() => setConfirming('stop')} disabled={busy}>Stop sharing</button>
              : <button type="button" className="ui-btn ui-btn-ghost ui-btn-danger" onClick={() => setConfirming('leave')} disabled={busy}>Leave folder</button>}
            <span className="ui-spacer" />
            <button type="button" className="ui-btn" onClick={syncNow} disabled={busy || syncing}>
              <RefreshCw size={14} className={syncing ? 'animate-spin' : undefined} /> Sync now
            </button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={onClose} disabled={busy}>Done</button>
          </>
        )
      ) : (
        <>
          <button type="button" className="ui-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={startSharing} disabled={busy || !server?.hubUrl}>
            {busy ? 'Sharing…' : 'Share folder'}
          </button>
        </>
      )}
    >
      {!shared && <NotSharedBody server={server} onClose={onClose} />}

      {shared && isOwner && (
        <section className="share-section" aria-label="Invite people">
          <div className="ui-label">Invite people as</div>
          <div className="ui-segmented" role="group" aria-label="Role for new people">
            {(['edit', 'listen'] as InviteRole[]).map((r) => (
              <button key={r} type="button" aria-pressed={inviteRole === r} onClick={() => { setInviteRole(r); setCreated(null); }}>
                {roleLabel[r]}
              </button>
            ))}
          </div>
          <p className="ui-hint">{roleHint[inviteRole]}. Invites open only in DAWLab.</p>
          {created ? (
            <InviteCode invite={created} />
          ) : (
            <button type="button" className="ui-btn ui-btn-primary share-create" onClick={createInvite} disabled={busy}>
              Create invite
            </button>
          )}
        </section>
      )}

      {shared && isOwner && invites.length > 0 && (
        <section className="share-section" aria-label="Open invites">
          <div className="ui-label">Open invites</div>
          <ul className="share-list">
            {invites.map((inv) => (
              <li key={inv.id} className="share-row">
                <span className="ui-badge ui-badge-muted">{roleLabel[inv.role]}</span>
                <span className="share-row-main">
                  {inv.code && <span className="share-row-code ui-mono" aria-label="Open invite code">{inv.code}</span>}
                  <span>Used {inv.uses} of {inv.maxUses} · expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                </span>
                {inv.code && <CopyCodeButton code={inv.code} />}
                <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => revoke(inv.id)} disabled={busy}>Revoke</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shared && isOwner && storage?.totalBytes != null && storage.freeBytes != null && (
        <ServerStorage totalBytes={storage.totalBytes} freeBytes={storage.freeBytes} />
      )}

      {shared && (
        <section className="share-section" aria-label="People">
          <div className="ui-label">People</div>
          <ul className="share-list">
            {(details?.members ?? shared.members).map((m) => (
              <li key={m.id} className="share-row">
                <span className="share-avatar" aria-hidden>{m.name.slice(0, 1).toUpperCase()}</span>
                <span className="share-row-main">
                  {m.name}{m.id === shared.memberId ? ' (you)' : ''}
                </span>
                {isOwner && m.role !== 'owner' ? (
                  <>
                    <select
                      className="share-role-select"
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value as InviteRole)}
                      disabled={busy}
                      aria-label={`Role of ${m.name}`}
                    >
                      <option value="edit">{roleLabel.edit}</option>
                      <option value="listen">{roleLabel.listen}</option>
                    </select>
                    <button
                      type="button"
                      className="ui-icon-btn"
                      onClick={() => setConfirming({ removeMemberId: m.id, name: m.name })}
                      disabled={busy}
                      aria-label={`Remove ${m.name}`}
                      title={`Remove ${m.name}`}
                    >
                      <UserMinus size={15} />
                    </button>
                  </>
                ) : (
                  <span className="ui-badge ui-badge-muted">{roleLabel[m.role]}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className={`ui-status ${error ? 'ui-status-error' : ''}`} role={error ? 'alert' : 'status'}>
        {error || progress || (shared ? syncLine(shared, syncStatus) : '')}
      </p>
    </Dialog>
  );
}

function syncLine(shared: SharedFolder, s?: SyncStatus): string {
  if (s?.state === 'paused') return 'Sync stopped. Press Sync now to try again.';
  if (s?.state === 'syncing') return s.message || 'Syncing…';
  if (s?.state === 'error' || (!s && shared.lastError)) return `Last sync had a problem: ${s?.error ?? shared.lastError}`;
  return `Synced ${relativeTime(s?.lastSync ?? shared.lastSync)}. DAWLab syncs on its own every few minutes and after you save a version.`;
}

function NotSharedBody({ server, onClose }: { server: { hubUrl: string; hasKey: boolean } | null; onClose: () => void }) {
  const navigate = useNavigate();
  if (server && !server.hubUrl) {
    return (
      <div className="share-callout">
        <strong>Connect a DAWLab server first</strong>
        <p className="ui-hint">Sharing goes through your own DAWLab server. Add its address and password once in Settings.</p>
        <button type="button" className="ui-btn" onClick={() => { onClose(); navigate('/settings#server'); }}>Open Settings</button>
      </div>
    );
  }
  return (
    <ul className="share-points">
      <li>You choose who can change projects (collaborators) and who can only listen (listeners).</li>
      <li>New projects you add to this folder are shared too. Versions sync on their own.</li>
      <li>You can remove people or stop sharing at any time. Everyone keeps their copies.</li>
      {server?.hubUrl && <li className="ui-hint">Server: {server.hubUrl}</li>}
    </ul>
  );
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(n < 10 * 1024 ** 3 ? 1 : 0)} GB`;

/** Owner only: how much room is left on the server. */
function ServerStorage({ totalBytes, freeBytes }: { totalBytes: number; freeBytes: number }) {
  const used = totalBytes > 0 ? (totalBytes - freeBytes) / totalBytes : 0;
  const level = used >= 0.95 ? 'danger' : used >= 0.8 ? 'warning' : '';
  return (
    <section className="share-section" aria-label="Server space">
      <div className="ui-label">Server space</div>
      <div className="share-storage-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}>
        <div className={`share-storage-fill ${level}`} style={{ width: `${Math.min(100, used * 100)}%` }} />
      </div>
      <p className="ui-hint">{gb(freeBytes)} free of {gb(totalBytes)}. Only you see this.</p>
    </section>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="ui-btn ui-btn-sm" onClick={copy} aria-label="Copy open invite code">
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function InviteCode({ invite }: { invite: CreatedInvite }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? invite.code : invite.link);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };
  return (
    <div className="share-invite">
      <div className="share-code ui-mono" aria-label="Invite code">{invite.code}</div>
      <div className="share-invite-actions">
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => copy('code')}>
          {copied === 'code' ? <Check size={14} /> : <Copy size={14} />} Copy invite code
        </button>
        <button type="button" className="ui-btn" onClick={() => copy('link')}>
          {copied === 'link' ? <Check size={14} /> : <Link2 size={14} />} Copy app link
        </button>
      </div>
      <p className="ui-hint">
        {roleLabel[invite.role]} · works for {invite.maxUses} {invite.maxUses === 1 ? 'person' : 'people'} until {new Date(invite.expiresAt).toLocaleDateString()}.
        They paste it in DAWLab → Join shared folder. The app link opens DAWLab directly.
      </p>
    </div>
  );
}

function ConfirmBar({ confirming, name, busy, onCancel, onConfirm }: {
  confirming: Exclude<Confirming, null>; name: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const text = confirming === 'stop'
    ? `Stop sharing “${name}”? Everyone loses access. All copies, including yours, stay where they are.`
    : confirming === 'leave'
      ? `Leave “${name}”? Your copies stay on this Mac but stop syncing.`
      : `Remove ${confirming.name}? Their copies stop syncing.`;
  const label = confirming === 'stop' ? 'Stop sharing' : confirming === 'leave' ? 'Leave' : 'Remove';
  return (
    <>
      <span className="share-confirm-text">{text}</span>
      <button type="button" className="ui-btn" onClick={onCancel} disabled={busy} data-autofocus>Cancel</button>
      <button type="button" className="ui-btn ui-btn-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : label}</button>
    </>
  );
}
