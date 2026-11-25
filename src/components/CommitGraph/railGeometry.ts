/**
 * The rail's drawing, from where each row sits: one straight line through the
 * main dots (newest to oldest, no stubs past the ends), and for each folded
 * alternative a smooth curve from the center of the dot it split from up to its
 * own lane, then straight through its dots, ending in a dot. Pure: tested
 * without a browser.
 */

/** x of lane 0 (main) and the step to each further lane. */
export const LANE_X = 8;
export const LANE_STEP = 16;
/** Height over which a branch turns from main into its lane. */
export const CURVE_RISE = 26;

export interface RailMark {
  /** "v:<commit id>", "fold:<branch>" or "unsaved". */
  key: string;
  /** Vertical center of the row, relative to the rail's top. */
  y: number;
}

export interface RailGeometryInput {
  /** Versions on this alternative, any order. */
  main: string[];
  folds: Array<{ branch: string; parent: string; versions: string[]; open: boolean }>;
  current: string | null;
  auto?: Set<string>;
}

export interface RailDot { key: string; x: number; y: number; lane: string | null; current: boolean; hollow: boolean; unsaved: boolean }
export interface RailPath { key: string; d: string; lane: string | null; dashed?: boolean }

export interface RailGeometry {
  gutter: number;
  dots: RailDot[];
  paths: RailPath[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function railGeometry(input: RailGeometryInput, marks: RailMark[]): RailGeometry {
  const y = new Map(marks.map((m) => [m.key, m.y]));
  const dots: RailDot[] = [];
  const paths: RailPath[] = [];
  const auto = input.auto ?? new Set<string>();

  // Main lane.
  const mainYs: number[] = [];
  for (const id of input.main) {
    const at = y.get(`v:${id}`);
    if (at === undefined) continue;
    mainYs.push(at);
    dots.push({ key: `v:${id}`, x: LANE_X, y: at, lane: null, current: id === input.current, hollow: auto.has(id), unsaved: false });
  }
  if (mainYs.length > 1) {
    paths.push({ key: 'main', d: `M${LANE_X},${r1(Math.min(...mainYs))} L${LANE_X},${r1(Math.max(...mainYs))}`, lane: null });
  }
  // Unsaved work: the next version, not saved yet, joined to the version it starts from by a dashed line.
  const unsavedY = y.get('unsaved');
  if (unsavedY !== undefined) {
    dots.push({ key: 'unsaved', x: LANE_X, y: unsavedY, lane: null, current: false, hollow: true, unsaved: true });
    const from = (input.current ? y.get(`v:${input.current}`) : undefined) ?? (mainYs.length ? Math.min(...mainYs) : undefined);
    if (from !== undefined && from > unsavedY) paths.push({ key: 'unsaved', d: `M${LANE_X},${r1(unsavedY)} L${LANE_X},${r1(from)}`, lane: null, dashed: true });
  }

  // Folded alternatives: lanes by order, so two from the same version never overlap.
  let lanes = 0;
  const parentLanes = new Map<string, number>();
  for (const f of input.folds) {
    const foldY = y.get(`fold:${f.branch}`);
    if (foldY === undefined) continue;
    const n = (parentLanes.get(f.parent) ?? 0) + 1;
    parentLanes.set(f.parent, n);
    const lane = n;
    lanes = Math.max(lanes, lane);
    const x = LANE_X + lane * LANE_STEP;

    // Its dots: the folded row when closed; each version (newest at the top) when open.
    const points = f.open
      ? f.versions.map((id) => ({ key: `v:${id}`, y: y.get(`v:${id}`) })).filter((p): p is { key: string; y: number } => p.y !== undefined)
      : [{ key: `fold:${f.branch}`, y: foldY }];
    if (points.length === 0) continue;
    for (const p of points) {
      const id = p.key.slice(2);
      dots.push({ key: `${f.branch}|${p.key}`, x, y: p.y, lane: f.branch, current: f.open && id === input.current, hollow: f.open && auto.has(id), unsaved: false });
    }
    const top = Math.min(...points.map((p) => p.y));
    const bottom = Math.max(...points.map((p) => p.y));
    const parentY = y.get(`v:${f.parent}`);
    let d = ''
    if (parentY !== undefined && parentY > bottom) {
      // From the center of the dot it split from, an S-curve over one row into the lane, then straight up.
      const gap = parentY - bottom;
      const turn = Math.min(gap, CURVE_RISE);
      const end = parentY - turn;
      d = `M${LANE_X},${r1(parentY)} C${LANE_X},${r1(parentY - turn / 2)} ${x},${r1(end + turn / 2)} ${x},${r1(end)}`;
      if (end > top) d += ` L${x},${r1(top)}`;
    } else if (top < bottom) {
      d = `M${x},${r1(bottom)} L${x},${r1(top)}`;
    }
    if (d) paths.push({ key: `fork:${f.branch}`, d, lane: f.branch });
  }

  return { gutter: Math.max(34, LANE_X * 2 + lanes * LANE_STEP + 2), dots, paths };
}
