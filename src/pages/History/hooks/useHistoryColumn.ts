import { useCallback, useState } from 'react';

export const HISTORY_COL_MIN = 360;
export const HISTORY_COL_MAX = 600;
export const HISTORY_COL_DEFAULT = 440;
const KEY = 'dawlab.historyColumnWidth';

export const clampColumn = (w: number) => Math.round(Math.min(HISTORY_COL_MAX, Math.max(HISTORY_COL_MIN, w)));

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? clampColumn(v) : HISTORY_COL_DEFAULT;
  } catch {
    return HISTORY_COL_DEFAULT;
  }
}

function save(w: number) {
  try { localStorage.setItem(KEY, String(w)); } catch { /* not kept: fine */ }
}

/** Width of the history column on wide windows: dragged on its divider (or arrow keys), remembered. */
export function useHistoryColumn() {
  const [width, setWidth] = useState(load);

  const set = useCallback((w: number) => {
    const next = clampColumn(w);
    setWidth(next);
    save(next);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const startX = e.clientX;
    const startW = width;
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => set(startW + ev.clientX - startX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [width, set]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); set(width - 20); }
    if (e.key === 'ArrowRight') { e.preventDefault(); set(width + 20); }
  }, [width, set]);

  return { width, set, startDrag, onKey };
}
