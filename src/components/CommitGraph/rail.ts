/**
 * The version rail: the versions of one alternative, newest first, with each
 * parallel version folded into one row at the point where it split off.
 * Pure: the History rail renders it, tests check it.
 */

export interface RailCommit {
  commit_id: string;
  timestamp: string;
  message: string;
  author: string;
  parent?: string;
  auto?: boolean;
  preview_file?: string;
  tags?: string[];
}

export interface RailFork {
  /** The alternative's name, e.g. "elenadanilova · 25 Nov (2)". */
  branch: string;
  /** A parallel version someone else saved (Preview, Dismiss), or an alternative made on purpose. */
  kind?: 'parallel' | 'alternative';
  author: string;
  /** The version on this alternative both people saved on top of. */
  parent: string;
  commits: RailCommit[];
}

export type RailItem =
  | { kind: 'version'; commit: RailCommit }
  | { kind: 'fold'; fork: RailFork; versions: RailCommit[] };

const newestFirst = (a: RailCommit, b: RailCommit) =>
  b.timestamp.localeCompare(a.timestamp) || String(b.commit_id).localeCompare(String(a.commit_id));

/**
 * Rows newest first. A fork's row sits just above the version it split from
 * (it is newer than that version); one whose split point isn't on this
 * alternative goes on top.
 */
export function railItems(commits: RailCommit[], forks: RailFork[]): RailItem[] {
  const rows: RailItem[] = [];
  const sorted = [...commits].sort(newestFirst);
  const ids = new Set(sorted.map((c) => String(c.commit_id)));
  const byParent = new Map<string, RailFork[]>();
  const orphans: RailFork[] = [];
  for (const f of forks) {
    if (!f.commits.length) continue;
    if (ids.has(String(f.parent))) byParent.set(f.parent, [...(byParent.get(f.parent) ?? []), f]);
    else orphans.push(f);
  }
  const fold = (f: RailFork): RailItem => ({ kind: 'fold', fork: f, versions: [...f.commits].sort(newestFirst) });
  for (const f of orphans) rows.push(fold(f));
  for (const c of sorted) {
    for (const f of byParent.get(String(c.commit_id)) ?? []) rows.push(fold(f));
    rows.push({ kind: 'version', commit: c });
  }
  return rows;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14:20" for today, "24 Nov" for older days, "24 Nov 2025" for another year. Timestamps are YYYYMMDDHHmmss (local). */
export function railTime(timestamp: string, now: Date = new Date()): string {
  const d = String(timestamp).replace(/\D/g, '');
  if (d.length < 12) return '';
  const y = Number(d.slice(0, 4)), mo = Number(d.slice(4, 6)), day = Number(d.slice(6, 8));
  const hh = d.slice(8, 10), mm = d.slice(10, 12);
  if (y === now.getFullYear() && mo === now.getMonth() + 1 && day === now.getDate()) return `${hh}:${mm}`;
  const date = `${day} ${MONTHS[mo - 1] ?? ''}`.trim();
  return y === now.getFullYear() ? date : `${date} ${y}`;
}

/** The muted right-hand text: author only when it isn't you, then the time. */
export function railWho(commit: RailCommit, me: string | null | undefined, now?: Date): string {
  const time = railTime(commit.timestamp, now);
  const other = commit.author && me && commit.author !== me && commit.author !== 'me' ? commit.author : '';
  return [other, time].filter(Boolean).join(' · ');
}

/** A version's one-line title; "Created branch X from commit …" reads as the start of an alternative. */
export function railMessage(message: string): string {
  const first = String(message ?? '').split('\n')[0].trim()
  const m = first.match(/^Created branch (.+?)(?: from (?:commit )?[A-Za-z0-9_-]+)?$/)
  return m ? `Started the alternative “${m[1]}”` : first || 'Version'
}
