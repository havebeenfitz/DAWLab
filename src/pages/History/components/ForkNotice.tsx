import { GitFork } from 'lucide-react';
import './ParallelVersionBanner.css';

interface Props {
  /** The alternative being viewed, when it is a parallel version. */
  forkOf?: { branch: string; author: string } | null;
  branchName: string;
  /** Number of versions on the alternative it split from. */
  fromCount: number;
  onGoTo: (branch: string) => void;
}

/**
 * Shown on a parallel alternative: says this is a side line of another
 * alternative, that the rest of the history is there, and takes you back.
 */
export function ForkNotice({ forkOf, branchName, fromCount, onGoTo }: Props) {
  if (!forkOf) return null;
  return (
    <div className="parallel-banner fork-notice" role="note" aria-label="Parallel alternative">
      <GitFork size={16} aria-hidden className="parallel-icon" />
      <span className="parallel-text" style={{ display: "block" }}>
        <strong>{branchName}</strong> is a parallel version of <strong>{forkOf.branch}</strong>: it was saved while someone else saved on {forkOf.branch} too.
        {' '}The other {fromCount} version{fromCount === 1 ? '' : 's'} of the project are on {forkOf.branch}; nothing was lost.
      </span>
      <button type="button" className="ui-btn ui-btn-sm" onClick={() => onGoTo(forkOf.branch)}>Go to {forkOf.branch}</button>
    </div>
  );
}
