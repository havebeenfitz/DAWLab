import { useState } from 'react';
import { useLibraryPreview } from '@/hooks/useLibraryPreview';
import { Dialog } from '@/components/ui/Dialog';
import { notify, errorMessage } from '@/lib/notify';
import { CompareDialog } from '../components/ParallelVersionBanner';
import type { ParallelVersion } from '../../../../shared/forks';

/**
 * Listen, Compare and Make main for a parallel version, used from the ⋯ menu
 * on its folded row in the rail. Returns the actions and the dialogs they open.
 */
export function useParallelActions(projectName: string, username: string, currentTipId: string | null, onChanged: () => Promise<void> | void) {
  const player = useLibraryPreview();
  const [comparing, setComparing] = useState<ParallelVersion | null>(null);
  const [confirming, setConfirming] = useState<ParallelVersion | null>(null);
  const [busy, setBusy] = useState(false);

  const listen = (p: ParallelVersion) => {
    if (!p.tip.preview_file) return;
    void player.toggleSource(`parallel:${p.tip.commit_id}`, () =>
      window.ipcRenderer.invoke('get-preview-url', projectName, p.tip.commit_id, p.tip.preview_file) as Promise<string | null>);
  };

  const makeMain = async (p: ParallelVersion) => {
    setBusy(true);
    try {
      await window.ipcRenderer.invoke('make-parallel-version-main', projectName, p.branch, username);
      notify.success(`${p.author}’s version is now on ${p.from}`, 'Your version stays in the history. The project folder now has theirs.');
      setConfirming(null);
      await onChanged();
    } catch (err) {
      notify.error('Couldn’t make it main', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const menu = (p: ParallelVersion) => [
    { label: player.playingId === `parallel:${p.tip.commit_id}` ? 'Pause' : 'Listen', onClick: () => listen(p), disabled: !p.tip.preview_file },
    { label: 'Compare with yours', onClick: () => setComparing(p), disabled: !currentTipId },
    { label: 'Make main…', onClick: () => setConfirming(p) },
  ];

  const dialogs = (
    <>
      <CompareDialog projectName={projectName} version={comparing} baseId={currentTipId} onClose={() => setComparing(null)} />
      <Dialog
        open={confirming !== null}
        title={confirming ? `Continue ${confirming.from} with ${confirming.author}’s version?` : ''}
        subtitle="Yours stays in the history. Your unsaved work is kept as a version first."
        onClose={() => setConfirming(null)}
        busy={busy}
        footer={
          <>
            <button type="button" className="ui-btn" onClick={() => setConfirming(null)} disabled={busy}>Cancel</button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => { if (confirming) void makeMain(confirming); }} disabled={busy}>
              {busy ? 'Working…' : 'Make main'}
            </button>
          </>
        }
      >
        {confirming && <p className="ui-hint">“{confirming.tip.message}” becomes the newest version on {confirming.from}, and the project folder gets it.</p>}
      </Dialog>
    </>
  );

  return { menu, dialogs };
}
