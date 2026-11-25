import { useEffect, useState } from 'react';
import { Copy, Check, FolderUp } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { hub, errorText, onHubProgress, relativeTime, type ProjectRemote } from './hub';
import './Sharing.css';

interface Props {
  projectName: string | null;
  onClose: () => void;
  /** Hands over to the folder dialog: sharing always happens per folder. */
  onShareFolder: (folderId: string, folderName: string) => void;
}

interface Context { projectId: string; folderId: string | null; folderName: string | null }

/**
 * Sharing starts from a project in many places, but always shares a folder.
 * A project in a shared folder opens that folder's sharing; otherwise this
 * offers to share its folder, or to put it in a new folder of its own.
 * Projects shared one by one before folders existed keep their links here.
 */
export function ShareProjectDialog({ projectName, onClose, onShareFolder }: Props) {
  const open = projectName !== null;
  const [ctx, setCtx] = useState<Context | null>(null);
  const [legacy, setLegacy] = useState<ProjectRemote | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectName) return;
    let cancelled = false;
    setCtx(null); setLegacy(null); setError(''); setStatus('');
    (async () => {
      const shared = await hub.getProjectFolder(projectName).catch(() => null);
      if (cancelled) return;
      if (shared) { onShareFolder(shared.folderId, shared.name); return; }
      const [remote, context] = await Promise.all([
        hub.getRemote(projectName).catch(() => null),
        window.ipcRenderer.invoke('hub-project-share-context', projectName) as Promise<Context | null>,
      ]);
      if (cancelled) return;
      setLegacy(remote);
      setCtx(context);
    })();
    return () => { cancelled = true; };
  }, [projectName, onShareFolder]);

  useEffect(() => (projectName ? onHubProgress(projectName, setStatus) : undefined), [projectName]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  const ownFolder = () => run(async () => {
    const made = await window.ipcRenderer.invoke('hub-make-folder-for-project', projectName) as { folderId: string; folderName: string };
    window.dispatchEvent(new CustomEvent('dawlab:library-changed', { detail: {} }));
    onShareFolder(made.folderId, made.folderName);
  });

  if (legacy) {
    return (
      <Dialog
        open={open}
        title={`“${projectName}” is shared on its own`}
        subtitle="It was shared before shared folders existed. Its links still work."
        onClose={onClose}
        busy={busy}
        footer={
          <>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-danger" disabled={busy}
              onClick={() => run(async () => { await hub.unlinkProject(projectName!); onClose(); })}>
              Disconnect
            </button>
            <span className="ui-spacer" />
            <button type="button" className="ui-btn" disabled={busy}
              onClick={() => run(async () => { const r = await hub.syncProject(projectName!); setLegacy(r.remote); setStatus(`Synced: sent ${r.pushed}, received ${r.pulled} version(s).`); })}>
              Sync now
            </button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={onClose} disabled={busy}>Done</button>
          </>
        }
      >
        <div className="share-legacy-links">
          {legacy.editUrl && <CopyRow label="Collaborator link" value={legacy.editUrl} />}
          {legacy.listenUrl && <CopyRow label="Listener link" value={legacy.listenUrl} />}
          <p className="ui-hint">
            These links open only in DAWLab: Join shared folder → paste. Last synced {relativeTime(legacy.lastSync)}.
            Disconnect stops syncing on this Mac; to share with people management, put the project in a shared folder.
          </p>
        </div>
        <p className={`ui-status ${error ? 'ui-status-error' : ''}`}>{error || status}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open && ctx !== null}
      title={`Share “${projectName}”`}
      subtitle="DAWLab shares folders: everyone you invite gets the folder and every project in it."
      onClose={onClose}
      busy={busy}
      footer={<button type="button" className="ui-btn" onClick={onClose} disabled={busy}>Cancel</button>}
    >
      <div className="share-section">
        {ctx?.folderId && (
          <button type="button" className="ui-btn ui-btn-primary share-create" disabled={busy}
            onClick={() => onShareFolder(ctx.folderId!, ctx.folderName ?? '')}>
            Share the folder “{ctx.folderName}”
          </button>
        )}
        <button type="button" className={`ui-btn share-create ${ctx?.folderId ? '' : 'ui-btn-primary'}`} disabled={busy} onClick={ownFolder}>
          <FolderUp size={14} /> Share only this project
        </button>
        <p className="ui-hint">
          {ctx?.folderId
            ? `“Share only this project” moves it into a new folder named “${projectName}” inside “${ctx.folderName}”, and shares that.`
            : `This puts the project in a new folder named “${projectName}” and shares that folder.`}
        </p>
      </div>
      <p className={`ui-status ${error ? 'ui-status-error' : ''}`}>{error}</p>
    </Dialog>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ui-field">
      <label>{label}</label>
      <div className="ui-input-row">
        <input className="ui-input ui-mono" readOnly value={value} onFocus={(e) => e.target.select()} />
        <button type="button" className="ui-btn" aria-label={`Copy ${label}`}
          onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}
