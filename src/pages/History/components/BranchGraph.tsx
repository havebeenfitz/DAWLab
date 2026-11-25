import { useMemo, useState } from 'react';
import { GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
import { layoutBranchGraph, LANE_COLORS, type GraphBranch } from '../../../../shared/branch-graph';
import './BranchGraph.css';

interface Props {
  branches: GraphBranch[];
  selectedBranch: string;
  currentCommitId: string | null;
  onSelectBranch: (name: string) => void;
  onSelectCommit?: (branch: string, commitId: string) => void;
}

const COL = 26;
const ROW = 26;
const PAD = 14;
const LABEL_W = 150;

/**
 * The project's alternatives at a glance: one colored lane each, a dot per
 * version, lines where an alternative or a parallel version split off.
 */
export function BranchGraph({ branches, selectedBranch, currentCommitId, onSelectBranch, onSelectCommit }: Props) {
  const [open, setOpen] = useState(true);
  const graph = useMemo(() => layoutBranchGraph(branches, currentCommitId), [branches, currentCommitId]);
  if (graph.lanes.length < 2) return null; // a single line needs no map

  const pos = new Map(graph.nodes.map((n) => [n.id, { x: PAD + n.col * COL, y: PAD + n.lane * ROW }]));
  const width = PAD * 2 + Math.max(0, graph.columns - 1) * COL;
  const height = PAD * 2 + (graph.lanes.length - 1) * ROW;
  const branchOfLane = (lane: number) => graph.lanes[lane].name;

  return (
    <section className="branch-graph" aria-label="Alternatives map">
      <button type="button" className="branch-graph-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <GitBranch size={14} aria-hidden /> Alternatives map · {graph.lanes.length} lines
      </button>
      {open && (
        <div className="branch-graph-body">
          <ul className="branch-graph-labels" style={{ width: LABEL_W, paddingTop: PAD - ROW / 2 }}>
            {graph.lanes.map((l) => (
              <li key={l.name} style={{ height: ROW }}>
                <button
                  type="button"
                  className={`branch-graph-label${l.name === selectedBranch ? ' is-selected' : ''}`}
                  onClick={() => onSelectBranch(l.name)}
                  title={l.parallel ? `${l.name}: a parallel version` : l.name}
                  style={{ ['--lane' as string]: LANE_COLORS[l.color] }}
                >
                  <span className="branch-graph-swatch" aria-hidden />
                  <span className="branch-graph-name">{l.name}</span>
                  {l.parallel && <span className="branch-graph-tag">parallel</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="branch-graph-scroll">
            <svg width={width} height={height} role="img" aria-label={`${graph.nodes.length} versions on ${graph.lanes.length} lines`}>
              {graph.edges.map((e) => {
                const a = pos.get(e.from)!;
                const b = pos.get(e.to)!;
                const toLane = graph.nodes.find((n) => n.id === e.to)!.lane;
                const color = LANE_COLORS[graph.lanes[toLane].color];
                const d = a.y === b.y ? `M${a.x},${a.y} L${b.x},${b.y}` : `M${a.x},${a.y} C${a.x + COL * 0.6},${a.y} ${b.x - COL * 0.6},${b.y} ${b.x},${b.y}`;
                return <path key={`${e.from}-${e.to}-${e.kind}`} d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={e.kind === 'merge' ? '3 3' : undefined} opacity={0.85} />;
              })}
              {graph.nodes.map((n) => {
                const p = pos.get(n.id)!;
                const color = LANE_COLORS[graph.lanes[n.lane].color];
                return (
                  <g key={n.id} className="branch-graph-node" onClick={() => onSelectCommit?.(branchOfLane(n.lane), n.id)}>
                    <title>{`${n.message || 'Version'}${n.author ? ` · ${n.author}` : ''}${n.current ? ' · on this Mac' : ''}`}</title>
                    {n.current && <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="#fff" strokeWidth={2} />}
                    <circle cx={p.x} cy={p.y} r={5} fill={n.auto ? 'transparent' : color} stroke={color} strokeWidth={2} strokeDasharray={n.auto ? '2 2' : undefined} />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </section>
  );
}
