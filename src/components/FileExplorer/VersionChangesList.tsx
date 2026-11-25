import type { FileChange, FileDiff } from '../../../shared/version-diff';

const MARK: Record<FileChange['kind'], string> = { added: '+', removed: '−', modified: 'M', renamed: 'R' };
const WORD: Record<FileChange['kind'], string> = { added: 'Added', removed: 'Removed', modified: 'Changed', renamed: 'Moved' };

/** One line per changed file, like `git status`: + added, − removed, M changed, R moved. */
export function VersionChangesList({ diff, hasParent, parentMessage }: { diff: FileDiff; hasParent: boolean; parentMessage: string | null }) {
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
          <span className="chg-same">{diff.unchanged} unchanged</span>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const CHANGE_MARK = MARK;
export const CHANGE_WORD = WORD;
