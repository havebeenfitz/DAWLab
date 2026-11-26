import type { LogicChangeLine } from '@/pages/History/hooks/useWorkingChanges';

const ADDED = /-added$/;
const REMOVED = /-removed$/;

/**
 * What changed inside the DAW project, in words: markers, tempo changes,
 * channel strips, plugins, regions, notes, automation. A line that stands for
 * many ("34 regions added") opens to list them.
 */
export function ProjectChanges({ lines, hideSongTempo = false }: { lines: LogicChangeLine[]; hideSongTempo?: boolean }) {
  // The song tempo is already shown with the song; tempo changes inside the song are shown here.
  const shown = lines.filter((l) => !(hideSongTempo && l.kind === 'tempo' && /^Tempo \d/.test(l.text)));
  if (shown.length === 0) return null;
  return (
    <div className="song-changes project-changes" aria-label="Project">
      <div className="song-facts"><span className="song-label">Project</span></div>
      <ul className="changes-list song-change-list">
        {shown.map((l, i) => {
          const kind = ADDED.test(l.kind) ? 'added' : REMOVED.test(l.kind) || l.loss ? 'removed' : 'modified';
          const mark = kind === 'added' ? '+' : kind === 'removed' ? '−' : '~';
          return (
            <li key={`${i}:${l.text}`} className={`change-row change-${kind}`} title={l.text}>
              <span className="change-mark" aria-hidden>{mark}</span>
              {l.items && l.items.length > 0 ? (
                <details className="change-path project-change-group">
                  <summary>{l.text}</summary>
                  <ul>{l.items.map((t, j) => <li key={`${j}:${t}`}>{t}</li>)}</ul>
                </details>
              ) : (
                <span className="change-path">{l.text}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
