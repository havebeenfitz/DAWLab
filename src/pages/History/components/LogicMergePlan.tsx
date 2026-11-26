import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, TriangleAlert } from 'lucide-react';
import { errorMessage } from '@/lib/notify';

export interface MergeStep { key: string; kind: string; text: string; conflict?: string }
export interface MergePlan { alternative: string; readable: boolean; todo: MergeStep[]; done: MergeStep[]; yours: MergeStep[] }

interface Props {
  projectName: string;
  author: string;
  /** The version both saved on top of, your newest version, and theirs. */
  parentId: string;
  mineId: string;
  theirsId: string;
}

/**
 * Logic can't merge two projects, but it can import tracks from one into the
 * other. This lists what the other person changed that your folder doesn't
 * have yet, flags what you changed too, and checks again after you saved in Logic.
 */
export function LogicMergePlan({ projectName, author, parentId, mineId, theirsId }: Props) {
  const [plans, setPlans] = useState<MergePlan[] | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    setChecking(true); setError('');
    try {
      setPlans(await (window.ipcRenderer.invoke('logic-merge-plan', projectName, parentId, mineId, theirsId) as Promise<MergePlan[] | null>));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }, [projectName, parentId, mineId, theirsId]);

  useEffect(() => { void check(); }, [check]);

  if (!plans && !error) return checking ? <p className="ui-status">Working out what to bring over…</p> : null;
  if (!plans || plans.length === 0) return error ? <p className="ui-status ui-status-error" role="alert">{error}</p> : null;

  const many = plans.length > 1;
  const left = plans.reduce((n, p) => n + p.todo.length, 0);
  return (
    <section className="merge-plan" aria-label={`Bring ${author}’s changes into yours`}>
      <div className="merge-plan-head">
        <div className="ui-label">Bring {author}’s changes into yours</div>
        <button type="button" className="ui-btn ui-btn-sm" onClick={() => { void check(); }} disabled={checking}>
          <RefreshCw size={13} aria-hidden className={checking ? 'spin' : undefined} /> {checking ? 'Checking…' : 'Check my folder again'}
        </button>
      </div>
      {left > 0 && (
        <ol className="merge-plan-how">
          <li>Click <strong>Preview whole project</strong> to lay out {author}’s project in a folder of its own.</li>
          <li>In Logic, in your project: <strong>File › Import › Logic Projects</strong>, choose their project, and import the tracks and regions below.</li>
          <li>Make the other changes by hand, save in Logic, then check again here.</li>
        </ol>
      )}
      {error && <p className="ui-status ui-status-error" role="alert">{error}</p>}
      {plans.map((p) => (
        <div key={p.alternative || 'main'} className="merge-plan-part">
          {many && <div className="merge-plan-alt">{p.alternative || 'Project'}</div>}
          {!p.readable ? (
            <p className="ui-hint">This Logic project can’t be read in detail. Listen to both versions and compare by ear.</p>
          ) : p.todo.length === 0 ? (
            <p className="merge-plan-ok"><Check size={14} aria-hidden /> Your folder has all of {author}’s changes. Save a version to keep it.</p>
          ) : (
            <ul className="merge-plan-list">
              {p.todo.map((s) => (
                <li key={s.key} className={s.conflict ? 'merge-step conflict' : 'merge-step'}>
                  <span className="merge-box" aria-hidden />
                  <span>
                    {s.text}
                    {s.conflict && <span className="merge-conflict"><TriangleAlert size={12} aria-hidden /> {s.conflict}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {p.readable && p.done.length > 0 && (
            <details className="merge-plan-done">
              <summary>Already in your folder ({p.done.length})</summary>
              <ul>{p.done.map((s) => <li key={s.key}><Check size={12} aria-hidden /> {s.text}</li>)}</ul>
            </details>
          )}
        </div>
      ))}
    </section>
  );
}
