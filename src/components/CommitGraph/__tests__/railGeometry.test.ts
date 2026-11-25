import { describe, expect, it } from 'vitest';
import { railGeometry, LANE_X, LANE_STEP } from '../railGeometry';

// Rows 30px apart, centers at 15, 45, 75…
const at = (keys: string[]) => keys.map((key, i) => ({ key, y: 15 + i * 30 }));
const path = (g: ReturnType<typeof railGeometry>, key: string) => g.paths.find((p) => p.key === key)?.d;
const dotsOf = (g: ReturnType<typeof railGeometry>, lane: string | null) => g.dots.filter((d) => d.lane === lane).map((d) => [d.x, d.y]);

describe('rail drawing', () => {
  it('draws main as one straight line from the newest dot to the oldest, no stubs', () => {
    const g = railGeometry({ main: ['c', 'b', 'a'], folds: [], current: 'b' }, at(['v:c', 'v:b', 'v:a']));
    expect(path(g, 'main')).toBe(`M${LANE_X},15 L${LANE_X},75`);
    expect(dotsOf(g, null)).toEqual([[LANE_X, 15], [LANE_X, 45], [LANE_X, 75]]);
    expect(g.dots.find((d) => d.current)?.key).toBe('v:b');
  });

  it('a collapsed branch: a curve from the center of its parent dot to one dot on its lane', () => {
    const g = railGeometry({ main: ['c', 'b', 'a'], folds: [{ branch: 'elena', parent: 'b', versions: ['e1'], open: false }], current: null },
      at(['v:c', 'fold:elena', 'v:b', 'v:a']));
    const x = LANE_X + LANE_STEP;
    expect(dotsOf(g, 'elena')).toEqual([[x, 45]]);
    // An S-curve from the parent dot's center into the lane, then straight up to the dot.
    expect(path(g, 'fork:elena')).toBe(`M${LANE_X},75 C${LANE_X},62 ${x},62 ${x},49 L${x},45`);
    expect([LANE_X, x]).toEqual([8, 24]);
  });

  it('an open branch of 3 versions: curve to its oldest dot, straight line up, ending at the newest dot', () => {
    const g = railGeometry({ main: ['c', 'b', 'a'], folds: [{ branch: 'elena', parent: 'b', versions: ['e3', 'e2', 'e1'], open: true }], current: 'e2' },
      at(['v:c', 'fold:elena', 'v:e3', 'v:e2', 'v:e1', 'v:b', 'v:a']));
    const x = LANE_X + LANE_STEP;
    expect(dotsOf(g, 'elena')).toEqual([[x, 75], [x, 105], [x, 135]]);
    const d = path(g, 'fork:elena')!;
    expect(d.startsWith(`M${LANE_X},165 C`)).toBe(true);
    expect(d).toMatch(new RegExp(` ${x},139 L${x},75$`)); // through every branch dot, ending at the newest
    expect(g.dots.find((dot) => dot.current)?.lane).toBe('elena');
    // No dot on the folded row while it is open.
    expect(g.dots.some((dot) => dot.key.includes('fold:'))).toBe(false);
  });

  it('two branches from the same version get their own lanes', () => {
    const g = railGeometry({
      main: ['b', 'a'],
      folds: [{ branch: 'x', parent: 'a', versions: ['x1'], open: false }, { branch: 'y', parent: 'a', versions: ['y1'], open: false }],
      current: null,
    }, at(['v:b', 'fold:x', 'fold:y', 'v:a']));
    expect(dotsOf(g, 'x')[0][0]).toBe(LANE_X + LANE_STEP);
    expect(dotsOf(g, 'y')[0][0]).toBe(LANE_X + 2 * LANE_STEP);
    expect(g.gutter).toBe(LANE_X * 2 + 2 * LANE_STEP + 2);
  });

  it('a branch from the oldest version curves from the last main dot, and main stops there', () => {
    const g = railGeometry({ main: ['b', 'a'], folds: [{ branch: 'x', parent: 'a', versions: ['x1'], open: false }], current: null },
      at(['v:b', 'fold:x', 'v:a']));
    expect(path(g, 'main')).toBe(`M${LANE_X},15 L${LANE_X},75`);
    expect(path(g, 'fork:x')!.startsWith(`M${LANE_X},75`)).toBe(true);
  });

  it('joins unsaved work to the current version with a dotted line, apart from main', () => {
    const g = railGeometry({ main: ['b', 'a'], folds: [], current: 'b' }, at(['unsaved', 'v:b', 'v:a']));
    expect(path(g, 'main')).toBe(`M${LANE_X},45 L${LANE_X},75`);
    expect(g.paths.find((p) => p.key === 'unsaved')).toMatchObject({ d: `M${LANE_X},15 L${LANE_X},45`, dashed: true });
    expect(g.dots.find((d) => d.unsaved)).toMatchObject({ y: 15, hollow: true });
  });

  it('draws nothing it cannot place', () => {
    const g = railGeometry({ main: ['a'], folds: [{ branch: 'x', parent: 'gone', versions: [], open: true }], current: null }, at(['v:a']));
    expect(g.paths).toEqual([]);
    expect(g.dots).toHaveLength(1);
  });
});
