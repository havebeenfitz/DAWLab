import { useEffect, useState } from 'react';
import '../InputModal/InputModal.css';
import './Sharing.css';
import { hub, onHubProgress, errorText } from './hub';

interface OpenSharedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpened: (projectName: string) => void;
}

/** Paste a share link, pick where to put the project, and download it (previews only for a listener link). */
export const OpenSharedModal = ({ isOpen, onClose, onOpened }: OpenSharedModalProps) => {
  const [link, setLink] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError(''); setStatus('');
    return onHubProgress('open', setStatus);
  }, [isOpen]);

  if (!isOpen) return null;

  const pick = async () => {
    const chosen = await window.ipcRenderer.invoke('pick-folder');
    if (chosen) setFolder(chosen);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link || !folder) return;
    setBusy(true); setError('');
    try {
      const { projectName } = await hub.openShared(link, folder);
      setLink(''); setStatus('');
      onOpened(projectName);
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
        <h3>Open shared project</h3>
        <form className="modal-form" onSubmit={submit}>
          <div className="form-field">
            <label>Share link <span className="required">*</span></label>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://hub.example.com/s/..." required autoFocus disabled={busy} />
          </div>
          <div className="form-field">
            <label>Save into folder <span className="required">*</span></label>
            <div className="share-link">
              <input readOnly value={folder} placeholder="Choose a folder" onClick={pick} disabled={busy} />
              <button type="button" className="btn-secondary" onClick={pick} disabled={busy}>Choose</button>
            </div>
          </div>
          <div className={`share-status ${error ? 'share-error' : ''}`}>{error || status}</div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || !link || !folder}>{busy ? 'Downloading...' : 'Open'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
