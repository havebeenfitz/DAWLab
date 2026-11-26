import { useEffect, useState } from 'react';
import { GitFork, Play, Pause, GitCompare, Check, EyeOff, Eye } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { useLibraryPreview } from '@/hooks/useLibraryPreview';
import type { ParallelVersion } from '../../../../shared/forks';
import type { VersionChanges } from '@/hooks/useVersionChanges';
import { SongChanges } from '@/components/FileExplorer/SongChanges';
import { VersionChangesList } from '@/components/FileExplorer/VersionChangesList';
import { ProjectChanges } from '@/components/FileExplorer/ProjectChanges';
import { LogicMergePlan } from './LogicMergePlan';
import { notify, errorMessage } from '@/lib/notify';
import './ParallelVersionBanner.css';
import { ensureClosedInDaw } from '@/lib/dawGuard';

interface Props {
  projectName: string;
  /** Forks of the alternative being viewed, from openParallelVersions(). */
  versions: ParallelVersion[];
  /** Newest version of the alternative being viewed: what a parallel version is compared with. */
  currentTipId: string | null;
  username: string;
  /** After "make main": reload the history. */
  onChanged: () => Promise<void> | void;
  /** Lays the whole version out in a folder of its own to open in the DAW. */
  onPreview?: (p: ParallelVersion) => void;
}

/**
 * When someone saved on top of the same version as you, their work went into
 * its own alternative. This says so, and lets you listen to it, see how it
 * differs from yours, or continue the line with it.
 */
export function ParallelVersionBanner({ projectName, versions, currentTipId, username, onChanged, onPreview }: Props) {
  const player = useLibraryPreview();
  const [comparing, setComparing] = useState<ParallelVersion | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState<ParallelVersion | null>(null);
  if (versions.length === 0) return null;

  const listen = (p: ParallelVersion) => {
    if (!p.tip.preview_file) return;
    void player.toggleSource(`parallel:${p.tip.commit_id}`, () =>
      window.ipcRenderer.invoke('get-preview-url', projectName, p.tip.commit_id, p.tip.preview_file) as Promise<string | null>);
  };

  const makeMain = async (p: ParallelVersion) => {
    if (!(await ensureClosedInDaw(projectName, 'make it main'))) return;
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

  return (
    <div className="parallel-banners">
      {versions.map((p) => {
        const playing = player.playingId === `parallel:${p.tip.commit_id}`;
        return (
          <div key={p.branch} className="parallel-banner" role="region" aria-label={`Parallel version from ${p.author}`}>
            <GitFork size={16} aria-hidden className="parallel-icon" />
            <div className="parallel-text">
              <strong>Parallel version from {p.author}</strong>
              <span>
                “{p.tip.message}” was saved on the same version as yours, so it went into the alternative “{p.branch}”.
              </span>
            </div>
            {confirming === p.branch ? (
              <div className="parallel-actions">
                <span className="parallel-confirm">Continue {p.from} with {p.author}’s version? Yours stays in the history.</span>
                <button type="button" className="ui-btn ui-btn-sm" onClick={() => setConfirming(null)} disabled={busy}>Cancel</button>
                <button type="button" className="ui-btn ui-btn-sm ui-btn-primary" onClick={() => makeMain(p)} disabled={busy}>
                  {busy ? 'Working…' : 'Make main'}
                </button>
              </div>
            ) : (
              <div className="parallel-actions">
                <button
                  type="button"
                  className="ui-btn ui-btn-sm"
                  onClick={() => listen(p)}
                  disabled={!p.tip.preview_file}
                  title={p.tip.preview_file ? 'Play the preview of their version' : `${p.author} didn’t attach a preview to this version`}
                >
                  {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />} {playing ? 'Pause' : 'Listen'}
                </button>
                {onPreview && (
                  <button type="button" className="ui-btn ui-btn-sm parallel-preview-btn" onClick={() => onPreview(p)} title="Lay out their whole project in a folder of its own and open it. Yours stays as it is">
                    <Eye size={13} aria-hidden /> Preview whole project
                  </button>
                )}
                <button type="button" className="ui-btn ui-btn-sm" onClick={() => setComparing(p)} disabled={!currentTipId}>
                  <GitCompare size={13} aria-hidden /> Compare
                </button>
                <button type="button" className="ui-btn ui-btn-sm" onClick={() => setConfirming(p.branch)}>
                  <Check size={13} aria-hidden /> Make main
                </button>
                <button type="button" className="ui-btn ui-btn-sm ui-btn-ghost" onClick={() => setDismissing(p)} title="Hide this notice. The alternative stays, and they see your reason">
                  <EyeOff size={13} aria-hidden /> Dismiss…
                </button>
              </div>
            )}
          </div>
        );
      })}
      <CompareDialog projectName={projectName} version={comparing} baseId={currentTipId} onClose={() => setComparing(null)} />
      <DismissDialog
        projectName={projectName}
        version={dismissing}
        username={username}
        onClose={() => setDismissing(null)}
        onDone={async () => { setDismissing(null); await onChanged(); }}
      />
    </div>
  );
}

/** How the parallel version differs from the newest version of yours: song, plugins, files. */
export function CompareDialog({ projectName, version, baseId, onClose }: {
  projectName: string; version: ParallelVersion | null; baseId: string | null; onClose: () => void;
}) {
  const [changes, setChanges] = useState<VersionChanges | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!version || !baseId) return;
    let cancelled = false;
    setChanges(null); setError('');
    (window.ipcRenderer.invoke('get-version-changes', projectName, version.tip.commit_id, baseId) as Promise<VersionChanges | null>)
      .then((c) => { if (cancelled) return; if (c) setChanges(c); else setError('These versions can’t be compared on this Mac.'); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [projectName, version, baseId]);

  const plugins = changes?.plugins?.changes.filter((c) => c.kind !== 'same') ?? [];
  return (
    <Dialog
      open={version !== null}
      title={version ? `${version.author}’s version compared with yours` : ''}
      subtitle={version ? `“${version.tip.message}” vs the newest version on ${version.from}` : undefined}
      onClose={onClose}
      width="lg"
      footer={<button type="button" className="ui-btn ui-btn-primary" onClick={onClose}>Done</button>}
    >
      {error && <p className="ui-status ui-status-error" role="alert">{error}</p>}
      {!changes && !error && <p className="ui-status">Comparing…</p>}
      {changes && (
        <>
          {changes.song && <SongChanges song={changes.song} diff={changes.songChanges ?? null} />}
          {changes.logic && changes.logic.length > 0 && <ProjectChanges lines={changes.logic} hideSongTempo />}
          {changes.logic && version && baseId && (
            <LogicMergePlan projectName={projectName} author={version.author} parentId={version.parent} mineId={baseId} theirsId={version.tip.commit_id} />
          )}
          <section className="parallel-compare-plugins" aria-label="Plugin differences">
            <div className="ui-label">Plugins</div>
            {plugins.length === 0 ? <p className="ui-hint">Same plugins in both.</p> : (
              <ul className="changes-list">
                {plugins.map((c) => (
                  <li key={`${c.kind}:${c.plugin.name}:${c.plugin.manufacturer ?? ''}`} className={`change-row change-${c.kind === 'count' ? 'modified' : c.kind}`}>
                    <span className="change-mark">{c.kind === 'added' ? '+' : c.kind === 'removed' ? '−' : '~'}</span>
                    <span className="change-path">
                      {c.plugin.name}{c.kind === 'count' ? ` ×${c.before} → ×${c.after}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <VersionChangesList diff={changes.files} hasParent parentMessage="your newest version" />
        </>
      )}
    </Dialog>
  );
}

/** Dismissing needs a reason: it becomes a comment on their version, so they know. */
export function DismissDialog({ projectName, version, username, onClose, onDone }: {
  projectName: string; version: ParallelVersion | null; username: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setText(''); setError(''); }, [version]);

  const dismiss = async () => {
    if (!version || !text.trim()) return;
    setBusy(true); setError('');
    try {
      await window.ipcRenderer.invoke('dismiss-parallel-version', projectName, version.branch, username, text.trim());
      notify.success('Parallel version dismissed', `The alternative “${version.branch}” stays; ${version.author} sees your reason as a comment.`);
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={version !== null}
      title={version ? `Dismiss ${version.author}’s parallel version?` : ''}
      subtitle="The notice goes away for you. The alternative stays for everyone, and they can keep working in it."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="ui-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => { void dismiss(); }} disabled={busy || !text.trim()}>
            {busy ? 'Dismissing…' : 'Dismiss'}
          </button>
        </>
      }
    >
      <div className="ui-field">
        <label htmlFor="dismiss-reason">Why? {version ? `${version.author} sees this as a comment on “${version.tip.message}”.` : ''}</label>
        <textarea
          id="dismiss-reason"
          className="ui-input"
          rows={3}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Keeping my mix of the chorus for now"
          disabled={busy}
          data-autofocus
        />
      </div>
      {error && <p className="ui-status ui-status-error" role="alert">{error}</p>}
    </Dialog>
  );
}

