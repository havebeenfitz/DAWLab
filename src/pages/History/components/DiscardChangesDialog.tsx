import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import type { WorkingChange, WorkingChangeKind } from '../hooks/useWorkingChanges';
import '@/components/FileExplorer/FileExplorer.css';

interface Props {
  open: boolean;
  projectName: string;
  alternative: string;
  changes: WorkingChange[];
  dawOpen: string | null;
  onDiscard: () => Promise<void>;
  onClose: () => void;
}

// Shown as git does: + new since the save, M changed, − deleted. Each says what Discard does to it.
const ROW: Record<WorkingChangeKind, { mark: string; cls: string; word: string }> = {
  added: { mark: '+', cls: 'change-added', word: 'new since the last save, will be removed' },
  modified: { mark: 'M', cls: 'change-modified', word: 'changed, goes back to the saved copy' },
  deleted: { mark: '−', cls: 'change-removed', word: 'deleted, comes back' },
};
const ORDER: WorkingChangeKind[] = ['modified', 'added', 'deleted'];
const MAX_ROWS = 200;

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Confirms "Discard changes": lists what will be undone and says where the current files go. */
export function DiscardChangesDialog({ open, projectName, alternative, changes, dawOpen, onDiscard, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sorted = [...changes].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.path.localeCompare(b.path));
  const by = (k: WorkingChangeKind) => changes.filter((c) => c.kind === k).length;
  const toTrash = by('added') + by('modified');

  const discard = async () => {
    setBusy(true); setError('');
    try {
      await onDiscard();
    } catch (err) {
      setError(String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Discard changes?"
      subtitle={`${projectName} goes back to the last saved version of “${alternative}”.`}
      onClose={onClose}
      busy={busy}
      width="lg"
      footer={
        <>
          <button type="button" className="ui-btn" onClick={onClose} disabled={busy} data-autofocus>Cancel</button>
          <button type="button" className="ui-btn ui-btn-danger" onClick={() => { void discard(); }} disabled={busy || changes.length === 0}>
            {busy ? 'Discarding…' : 'Discard'}
          </button>
        </>
      }
    >
      {dawOpen && (
        <p className="ui-status ui-status-error" role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertTriangle size={16} aria-hidden style={{ flex: 'none', marginTop: 2 }} /> {dawOpen} is open. Close {projectName} there first, or it may save over the restored files.
        </p>
      )}
      <p className="changes-stats" aria-label="Summary">
        {by('modified') > 0 && <span className="chg-modified">{count(by('modified'), 'changed file')}</span>}
        {by('added') > 0 && <span className="chg-added">{count(by('added'), 'new file')}</span>}
        {by('deleted') > 0 && <span className="chg-removed">{count(by('deleted'), 'deleted file')}</span>}
      </p>
      <ul className="changes-list" aria-label="What will be undone" style={{ maxHeight: 280, overflowY: 'auto' }}>
        {sorted.slice(0, MAX_ROWS).map((c) => (
          <li key={c.path} className={`change-row ${ROW[c.kind].cls}`} title={ROW[c.kind].word}>
            <span className="change-mark" aria-label={ROW[c.kind].word}>{ROW[c.kind].mark}</span>
            <span className="change-path">{c.path}</span>
          </li>
        ))}
        {sorted.length > MAX_ROWS && <li className="change-row change-from">…and {sorted.length - MAX_ROWS} more</li>}
      </ul>
      <p className="ui-hint">
        {toTrash > 0
          ? `Your current ${count(toTrash, 'file')} (changed and new) go to the Trash first, in a folder named “${projectName} — discarded changes”, so you can still get them back.`
          : 'Nothing is overwritten: deleted files are only brought back.'}
      </p>
      {error && <p className="ui-status ui-status-error" role="alert">{error}</p>}
    </Dialog>
  );
}
