import type { FileChange, FileDiff } from '../../../shared/version-diff';
import type { VersionAudio } from '@/hooks/useVersionAudio';
import { PlayFileButton } from './PlayFileButton';

const MARK: Record<FileChange['kind'], string> = { added: '+', removed: '−', modified: 'M', renamed: 'R' };
const WORD: Record<FileChange['kind'], string> = { added: 'Added', removed: 'Removed', modified: 'Changed', renamed: 'Moved' };

/** One line per changed file, like `git status`: + added, − removed, M changed, R moved. */
export function VersionChangesList({ diff, hasParent, parentMessage, audio }: { diff: FileDiff; hasParent: boolean; parentMessage: string | null; audio?: VersionAudio }) {
  // A first version with no files at all: say just that, not "every file is new" and "0 unchanged".
  if (!hasParent && diff.changes.length === 0) {
    return <div className="changes-view"><div className="file-tree-empty">This version has no files</div></div>;
  }
  return (
    <div className="changes-view">
      <div className="changes-summary" aria-label="Summary of changes">
        {hasParent ? (
          <span className="changes-since">Compared with {parentMessage ? <>“{parentMessage}”</> : 'the previous version'}</span>
        ) : (
          <span className="changes-since">First version: every file is new</span>
        )}
        <span className="changes-stats">
          {diff.added > 0 && <span className="chg-added">+{diff.added}</span>}
          {diff.removed > 0 && <span className="chg-removed">−{diff.removed}</span>}
          {diff.modified > 0 && <span className="chg-modified">~{diff.modified}</span>}
          {diff.renamed > 0 && <span className="chg-renamed">→{diff.renamed}</span>}
          {hasParent && <span className="chg-same">{diff.unchanged} unchanged</span>}
        </span>
      </div>
      {diff.changes.length === 0 ? (
        <div className="file-tree-empty">No files changed in this version</div>
      ) : (
        <ul className="changes-list">
          {diff.changes.map(c => (
            <li key={`${c.kind}:${c.path}`} className={`change-row change-${c.kind}`} title={`${WORD[c.kind]}: ${c.from ? `${c.from} → ` : ''}${c.path}`}>
              <span className="change-mark" aria-label={WORD[c.kind]}>{MARK[c.kind]}</span>
              <span className="change-path">
                {c.from && <span className="change-from">{c.from} → </span>}
                {c.path}
              </span>
              {c.kind !== 'removed' && <PlayFileButton path={c.path} audio={audio} />}
            </li>
          ))}
        </ul>
      )}
      {diff.quiet && diff.quiet.length > 0 && (
        <div className="changes-quiet" title={diff.quiet.map((c) => c.path).join('\n')}>
          Not counted as changes: {describeQuiet(diff.quiet.map((c) => c.path))}
        </div>
      )}
    </div>
  );
}

/** "Logic window layout, 3 audio files re-saved with the same sound". */
function describeQuiet(paths: string[]): string {
  const audio = paths.filter((p) => /\.(wav|wave|aif|aiff|aifc|caf)$/i.test(p)).length;
  const layout = paths.length - audio;
  return [
    layout ? 'Logic window layout and thumbnail' : '',
    audio ? `${audio} audio file${audio === 1 ? '' : 's'} re-saved by the DAW with the same sound` : '',
  ].filter(Boolean).join(', ');
}

export const CHANGE_MARK = MARK;
export const CHANGE_WORD = WORD;
