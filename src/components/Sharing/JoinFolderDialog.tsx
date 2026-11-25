import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { hub, errorText, onHubProgress, roleHint, roleLabel, type InvitePreview } from './hub';
import './Sharing.css';

interface Props {
  /** null = closed; a string (possibly empty) = open with that code or dawlab:// link filled in. */
  prefill: string | null;
  onClose: () => void;
  onJoined: (folderId: string) => void;
}

const isLegacyLink = (s: string) => /^https?:\/\/\S+\/s\/[A-Za-z0-9_-]{20,}\/?$/.test(s.trim());
const looksLikeInvite = (s: string) => /^dawlab:\/\//i.test(s.trim()) || s.replace(/[^0-9a-z]/gi, '').length >= 12;

/** Paste an invite, see what it opens, choose where projects go on this Mac, join. */
export function JoinFolderDialog({ prefill, onClose, onJoined }: Props) {
  const open = prefill !== null;
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setInput(prefill ?? ''); setPreview(null); setError(''); setProgress('');
    window.ipcRenderer.invoke('hub-default-join-dir').then((d: string) => setDir(d || '')).catch(() => {});
  }, [open, prefill]);

  useEffect(() => {
    if (!open) return;
    const offJoin = onHubProgress('join', setProgress);
    const offOpen = onHubProgress('open', setProgress);
    return () => { offJoin(); offOpen(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    const mine = ++seq.current; // any earlier check is now stale
    if (isLegacyLink(input) || !looksLikeInvite(input)) { setError(''); setChecking(false); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const p = await hub.previewInvite(input);
        if (mine === seq.current) { setPreview(p); setError(''); }
      } catch (err) {
        if (mine === seq.current) setError(errorText(err));
      } finally {
        if (mine === seq.current) setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [input, open]);

  const pick = async () => {
    const chosen = await window.ipcRenderer.invoke('pick-folder');
    if (chosen) setDir(chosen);
  };

  const legacy = isLegacyLink(input);

  const join = async () => {
    if ((!preview && !legacy) || !dir) return;
    setBusy(true); setError('');
    try {
      if (legacy) {
        // A link to a single project, from before shared folders.
        await window.ipcRenderer.invoke('hub-open-shared', input.trim(), dir);
        window.dispatchEvent(new CustomEvent('dawlab:library-changed', { detail: {} }));
        onClose();
        return;
      }
      const joined = await hub.join(input, dir);
      if (joined.failed.length) {
        setError(`Joined, but ${joined.failed.length} project(s) could not be downloaded yet: ${joined.failed[0].project}. DAWLab will retry.`);
      }
      onJoined(joined.folderId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false); setProgress('');
    }
  };

  return (
    <Dialog
      open={open}
      title="Join a shared folder"
      subtitle="Paste the invite code or the dawlab:// link you were sent."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="ui-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={join} disabled={busy || (!preview && !legacy) || !dir}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </>
      }
    >
      <div className="ui-field">
        <label htmlFor="join-invite">Invite</label>
        <input
          id="join-invite"
          className="ui-input ui-mono"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="DAWL-7KQ4-MX2P-9TRB"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          data-autofocus
        />
      </div>

      {legacy && (
        <div className="share-preview">
          <strong>Link to a single project</strong>
          <span>This is an older kind of share link. DAWLab downloads the project into the folder below.</span>
        </div>
      )}

      {preview && (
        <div className="share-preview">
          <strong>{preview.space.name}</strong>
          <span>
            Shared by {preview.invitedBy} · {preview.projectCount} project{preview.projectCount === 1 ? '' : 's'} · {preview.memberCount} {preview.memberCount === 1 ? 'person' : 'people'}
          </span>
          <span>You join as {roleLabel[preview.role].toLowerCase()}: {roleHint[preview.role].toLowerCase()}.</span>
        </div>
      )}

      <div className="ui-field">
        <label htmlFor="join-dir">Save projects in</label>
        <div className="ui-input-row">
          <input id="join-dir" className="ui-input" value={dir} readOnly onClick={pick} disabled={busy} />
          <button type="button" className="ui-btn" onClick={pick} disabled={busy}><FolderOpen size={14} /> Choose…</button>
        </div>
        <p className="ui-hint">A folder named after the shared folder is created inside it.</p>
      </div>

      <p className={`ui-status ${error ? 'ui-status-error' : ''}`} role={error ? 'alert' : 'status'}>
        {error || progress || (checking ? 'Checking the invite…' : '')}
      </p>
    </Dialog>
  );
}
