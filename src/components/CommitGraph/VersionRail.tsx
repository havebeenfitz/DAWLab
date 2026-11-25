import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, LifeBuoy, Music } from 'lucide-react';
import { railItems, railWho, railMessage, type RailCommit, type RailFork } from './rail';
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
  /** Rendered at the top of the rail (the unsaved-changes block). */
  head?: React.ReactNode;
}

/** One version: a dot on the rail and a single line of text. */
function Row({ commit, lane, color, current, selected, me, onSelect, onContextMenu, last }: {
  commit: RailCommit; lane: 0 | 1; color: string; current: boolean; selected: boolean; me?: string | null; last: boolean;
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
      data-commit-id={commit.commit_id}
    >
      <span className="rail-gutter" aria-hidden>
        <span className={`rail-line main${last ? ' ends' : ''}`} />
        {lane === 1 && <span className="rail-line fork" style={{ background: color }} />}
        <span className={`rail-dot lane-${lane}`} style={{ background: commit.auto ? 'transparent' : color, borderColor: color }} />
      </span>
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

/** A parallel version folded into one outlined row where it split; opens to show its versions. */
function Fold({ fork, versions, color, props }: { fork: RailFork; versions: RailCommit[]; color: string; props: Props }) {
  const [open, setOpen] = useState(false);
  const n = versions.length;
  return (
    <div role="listitem" className="rail-fold-item">
      <div className="rail-fold-head">
        <span className="rail-gutter" aria-hidden>
          <span className="rail-line main" />
          <svg className="rail-curve" viewBox="0 0 34 30" preserveAspectRatio="none"><path d="M9 30 C 9 18, 25 18, 25 6" stroke={color} strokeWidth="2" fill="none" /></svg>
        </span>
        <div className="rail-fold" style={{ borderColor: color }}>
          <button type="button" className="rail-fold-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={14} aria-hidden style={{ color }} /> : <ChevronRight size={14} aria-hidden style={{ color }} />}
            <span className="rail-fold-name">{fork.author || fork.branch}</span>
            <span className="rail-fold-count">· {n} version{n === 1 ? '' : 's'}</span>
          </button>
          <span className="rail-fold-actions">
            {props.onPreviewFork && (
              <button type="button" className="rail-btn" onClick={() => props.onPreviewFork!(fork.branch)} title="Open their whole project in a folder of its own">
                <Eye size={12} aria-hidden /> Preview
              </button>
            )}
            {props.onDismissFork && (
              <button type="button" className="rail-btn" onClick={() => props.onDismissFork!(fork.branch)} title="Hide it for you, with a reason they see">
                <EyeOff size={12} aria-hidden /> Dismiss
              </button>
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
              lane={1}
              color={color}
              current={c.commit_id === props.currentCommitId}
              selected={c.commit_id === props.selectedCommitId}
              me={props.me}
              last={false}
              onSelect={props.onSelect}
              onContextMenu={props.onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** The versions of an alternative as a git-like rail, newest on top. */
export function VersionRail(props: Props) {
  const items = railItems(props.commits, props.forks);
  let forkIndex = 0;
  const lastVersion = [...items].reverse().find((i) => i.kind === 'version');
  return (
    <div className="version-rail">
      {props.head}
      <div role="list" aria-label="Versions">
        {items.map((item) => {
          if (item.kind === 'fold') {
            const color = FORK_COLORS[forkIndex++ % FORK_COLORS.length];
            return <Fold key={`fold:${item.fork.branch}`} fork={item.fork} versions={item.versions} color={color} props={props} />;
          }
          const c = item.commit;
          return (
            <Row
              key={c.commit_id}
              commit={c}
              lane={0}
              color="var(--rail-main)"
              current={c.commit_id === props.currentCommitId}
              selected={c.commit_id === props.selectedCommitId}
              me={props.me}
              last={item === lastVersion}
              onSelect={props.onSelect}
              onContextMenu={props.onContextMenu}
            />
          );
        })}
      </div>
    </div>
  );
}
