import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import '../InputModal/InputModal.css';
import './Sharing.css';
import { hub, onHubProgress, errorText, type ProjectRemote } from './hub';

interface ShareModalProps {
  isOpen: boolean;
  projectName: string;
  onClose: () => void;
  /** Called after a sync that pulled new versions, so the history can reload. */
  onSynced?: () => void;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="share-link-label">{label}</div>
      <div className="share-link">
        <input readOnly value={value} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

/** Share a project to a DAWLab Hub, show its links, and sync it. */
export const ShareModal = ({ isOpen, projectName, onClose, onSynced }: ShareModalProps) => {
  const [remote, setRemote] = useState<ProjectRemote | null>(null);
  const [hubUrl, setHubUrl] = useState('');
  const [hubKey, setHubKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError(''); setStatus('');
    hub.getRemote(projectName).then(setRemote).catch(() => setRemote(null));
    hub.getSettings().then((s) => { setHubUrl(s.hubUrl); setHubKey(s.hubKey); }).catch(() => {});
    return onHubProgress(projectName, setStatus);
  }, [isOpen, projectName]);

  if (!isOpen) return null;

  const run = async () => {
    setBusy(true); setError('');
    try {
      if (!remote) await hub.saveSettings({ hubUrl, hubKey });
      const result = remote ? await hub.sync(projectName) : await hub.share(projectName);
      setRemote(result.remote);
      setStatus(`Done: sent ${result.pushed} version(s), received ${result.pulled}.`);
      if (result.pulled > 0 || !remote) onSynced?.();
    } catch (err) {
      setError(errorText(err)); setStatus('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-content share-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close" disabled={busy} />
        <h3>{remote ? 'Shared project' : 'Share project'}</h3>
        {remote ? (
          <>
            <p className="share-hint">Both links open only in DAWLab (Add &gt; Open Shared Project). Anyone who has a link can use it, so send it privately.</p>
            {remote.editUrl && <CopyField label="Collaborator link: files, versions, comments" value={remote.editUrl} />}
            {remote.listenUrl && <CopyField label="Listener link: previews and comments only" value={remote.listenUrl} />}
            {remote.lastSync && <p className="share-hint">Last synced {new Date(remote.lastSync).toLocaleString()}</p>}
          </>
        ) : (
          <form className="modal-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <p className="share-hint">Uploads this project's versions to a DAWLab Hub server, so others can open it by link.</p>
            <div className="form-field">
              <label>Hub address</label>
              <input value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder="https://your-hub.onrender.com" required disabled={busy} />
            </div>
            <div className="form-field">
              <label>Hub key</label>
              <input type="password" value={hubKey} onChange={(e) => setHubKey(e.target.value)} placeholder="HUB_CREATE_KEY of the server" disabled={busy} />
            </div>
          </form>
        )}
        <div className={`share-status ${error ? 'share-error' : ''}`}>{error || status}</div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Close</button>
          <button type="button" className="btn-primary" onClick={run} disabled={busy || (!remote && !hubUrl)}>
            {busy ? 'Working...' : remote ? 'Sync now' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  );
};
