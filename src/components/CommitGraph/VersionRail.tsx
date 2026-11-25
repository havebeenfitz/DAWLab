import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, LifeBuoy, Music, MoreHorizontal } from 'lucide-react';
import { railItems, railWho, railMessage, type RailCommit, type RailFork } from './rail';
import { railGeometry, type RailMark } from './railGeometry';
import './VersionRail.css';

const FORK_COLORS = ['var(--rail-fork-1)', 'var(--rail-fork-2)', 'var(--rail-fork-3)'];

interface Props {
  commits: RailCommit[];
  forks: RailFork[];
  /** The version the project folder is on. */
  currentCommitId?: string;
  selectedCommitId: string | null;
  me?: string | null;
  onSelect: (commitId: string) => void;
  onContextMenu: (e: React.MouseEvent, commitId: string) => void;
  onPreviewFork?: (branch: string) => void;
  onDismissFork?: (branch: string) => void;
  /** More actions for a folded alternative (Listen, Compare, Make main, Switch…). */
  forkMenu?: (fork: RailFork) => Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  /** Rendered at the top of the rail (the unsaved-changes row). */
  head?: React.ReactNode;
}

/** One version: a single line of text; its dot is drawn by the rail's SVG. */
function Row({ commit, current, selected, me, onSelect, onContextMenu }: {
  commit: RailCommit; current: boolean; selected: boolean; me?: string | null;
  onSelect: (id: string) => void; onContextMenu: (e: React.MouseEvent, id: string) => void;
}) {
  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-current={current ? 'true' : undefined}
      aria-selected={selected}
      className={`rail-row${current ? ' is-current' : ''}${selected ? ' is-selected' : ''}${commit.auto ? ' is-auto' : ''}`}
      onClick={() => onSelect(commit.commit_id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(commit.commit_id); } }}
      onContextMenu={(e) => onContextMenu(e, commit.commit_id)}
      data-rail-mark={`v:${commit.commit_id}`}
    >
      <span className="rail-gutter" aria-hidden />
      <span className="rail-text">
        {commit.auto && <LifeBuoy size={12} aria-label="Kept automatically" className="rail-auto" />}
        <span className="rail-msg" title={commit.message}>{railMessage(commit.message)}</span>
        {current && <span className="rail-tag">current</span>}
        {commit.preview_file && <Music size={11} aria-label="Has a preview" className="rail-icon" />}
        <span className="rail-who">{railWho(commit, me)}</span>
      </span>
    </div>
  );
}

/** An alternative folded into one outlined row where it split; opens to show its versions. */
function Fold({ fork, versions, color, open, onToggle, props }: {
  fork: RailFork; versions: RailCommit[]; color: string; open: boolean; onToggle: () => void; props: Props;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const n = versions.length;
  const parallel = fork.kind !== 'alternative';
  const items = props.forkMenu?.(fork) ?? [];
  return (
    <div role="listitem" className="rail-fold-item">
      <div className="rail-fold-head" data-rail-mark={`fold:${fork.branch}`}>
        <span className="rail-gutter" aria-hidden />
        <div className="rail-fold" style={{ borderColor: color }}>
          <button type="button" className="rail-fold-toggle" onClick={onToggle} aria-expanded={open} title={fork.branch}>
            {open ? <ChevronDown size={14} aria-hidden style={{ color }} /> : <ChevronRight size={14} aria-hidden style={{ color }} />}
            <span className="rail-fold-name">{fork.branch}</span>
            <span className="rail-fold-count">· {n} version{n === 1 ? '' : 's'}</span>
          </button>
          <span className="rail-fold-actions">
            {parallel && props.onPreviewFork && (
              <button type="button" className="rail-btn" onClick={() => props.onPreviewFork!(fork.branch)} title="Open their whole project in a folder of its own">
                <Eye size={12} aria-hidden /> Preview
              </button>
            )}
            {parallel && props.onDismissFork && (
              <button type="button" className="rail-btn" onClick={() => props.onDismissFork!(fork.branch)} title="Hide it for you, with a reason they see">
                <EyeOff size={12} aria-hidden /> Dismiss
              </button>
            )}
            {items.length > 0 && (
              <span className="rail-menu-wrap">
                <button type="button" className="rail-btn icon" aria-label={`More for ${fork.branch}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
                  <MoreHorizontal size={14} aria-hidden />
                </button>
                {menuOpen && (
                  <span className="rail-menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                    {items.map((it) => (
                      <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setMenuOpen(false); it.onClick(); }}>
                        {it.label}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>
      </div>
      {open && (
        <div role="list" aria-label={`Versions in ${fork.branch}`}>
          {versions.map((c) => (
            <Row
              key={c.commit_id}
              commit={c}
              current={c.commit_id === props.currentCommitId}
              selected={c.commit_id === props.selectedCommitId}
              me={props.me}
              onSelect={props.onSelect}
              onContextMenu={props.onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** The versions of an alternative as a git-like rail, newest on top, drawn as one SVG. */
export function VersionRail(props: Props) {
  const items = railItems(props.commits, props.forks);
  const [openForks, setOpenForks] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<RailMark[]>([]);
  const [height, setHeight] = useState(0);

  const folds = items.flatMap((i) => (i.kind === 'fold' ? [i] : []));
  const colorOf = new Map(folds.map((f, i) => [f.fork.branch, FORK_COLORS[i % FORK_COLORS.length]]));
  const color = (lane: string | null) => (lane ? colorOf.get(lane) ?? FORK_COLORS[0] : 'var(--rail-main)');

  // Where every row sits, measured after layout, so the drawing lines up with the text.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const top = list.getBoundingClientRect().top;
      const next = [...list.querySelectorAll<HTMLElement>('[data-rail-mark]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { key: el.dataset.railMark!, y: Math.round((r.top - top + r.height / 2) * 10) / 10 };
      });
      setMarks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setHeight(list.scrollHeight);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(list);
    return () => ro?.disconnect();
  }, [props.commits, props.forks, openForks, props.head]);

  const g = railGeometry({
    main: props.commits.map((c) => c.commit_id),
    folds: folds.map((f) => ({ branch: f.fork.branch, parent: f.fork.parent, versions: f.versions.map((v) => v.commit_id), open: openForks.has(f.fork.branch) })),
    current: props.currentCommitId ?? null,
    auto: new Set([...props.commits, ...folds.flatMap((f) => f.versions)].filter((c) => c.auto).map((c) => c.commit_id)),
  }, marks);

  const toggle = (branch: string) => setOpenForks((prev) => {
    const next = new Set(prev);
    if (next.has(branch)) next.delete(branch); else next.add(branch);
    return next;
  });

  return (
    <div className="version-rail" style={{ ['--rail-gutter' as string]: `${g.gutter}px` }}>
      <div className="rail-list" ref={listRef}>
        <svg className="rail-svg" width={g.gutter} height={height} aria-hidden data-testid="rail-svg">
          {g.paths.map((p) => (
            <path key={p.key} d={p.d} stroke={color(p.lane)} strokeWidth={2} fill="none" strokeLinecap="round" />
          ))}
          {g.dots.map((d) => (
            <g key={d.key}>
              {d.current && <circle cx={d.x} cy={d.y} r={8.5} fill="none" stroke="var(--rail-text)" strokeWidth={1.5} />}
              <circle
                cx={d.x} cy={d.y} r={6}
                fill={d.hollow ? 'var(--rail-bg)' : color(d.lane)}
                stroke={d.unsaved ? 'var(--unsaved-fg)' : d.hollow ? color(d.lane) : 'var(--rail-bg)'}
                strokeWidth={2}
                strokeDasharray={d.unsaved ? '2 2' : undefined}
              />
            </g>
          ))}
        </svg>
        {props.head}
        <div role="list" aria-label="Versions">
          {items.map((item) => {
            if (item.kind === 'fold') {
              return (
                <Fold
                  key={`fold:${item.fork.branch}`}
                  fork={item.fork}
                  versions={item.versions}
                  color={color(item.fork.branch)}
                  open={openForks.has(item.fork.branch)}
                  onToggle={() => toggle(item.fork.branch)}
                  props={props}
                />
              );
            }
            const c = item.commit;
            return (
              <Row
                key={c.commit_id}
                commit={c}
                current={c.commit_id === props.currentCommitId}
                selected={c.commit_id === props.selectedCommitId}
                me={props.me}
                onSelect={props.onSelect}
                onContextMenu={props.onContextMenu}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
