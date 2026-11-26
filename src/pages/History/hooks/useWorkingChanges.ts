import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkingChangeKind = 'added' | 'modified' | 'deleted';
export interface WorkingChange { path: string; kind: WorkingChangeKind; quiet?: 'layout' | 'audio-header' }
export interface LogicChangeLine { kind: string; text: string; loss?: boolean; items?: string[] }
export interface WorkingChanges {
  baseCommitId: string | null;
  /** Changes to the song. */
  changes: WorkingChange[];
  /** Differences that aren't changes to the song: Logic's window layout, audio headers rewritten on open. */
  quiet?: WorkingChange[];
  /** What changed inside the Logic project, in words; null when not read. */
  logic?: LogicChangeLine[] | null;
  /** "Logic Pro" / "Ableton Live" when that app is running, else null. */
  dawOpen: string | null;
}

const EMPTY: WorkingChanges = { baseCommitId: null, changes: [], quiet: [], logic: null, dawOpen: null };
/** How often to look again while the project is open; only changed files are read again. */
export const RECHECK_MS = 8000;

/**
 * What differs between the project folder and its last saved version.
 * Checked when the project opens, when the window gets focus, and every few seconds.
 */
export function useWorkingChanges(projectName: string | undefined, enabled: boolean, versionKey: string) {
  const [state, setState] = useState<WorkingChanges>(EMPTY);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (!projectName || !enabled || busy.current) return;
    busy.current = true;
    try {
      const next = await window.ipcRenderer.invoke('get-working-changes', projectName) as WorkingChanges;
      setState(next ?? EMPTY);
    } catch {
      setState(EMPTY); // A folder we can't read has nothing we could discard either.
    } finally {
      busy.current = false;
    }
  }, [projectName, enabled]);

  useEffect(() => {
    if (!enabled) { setState(EMPTY); return; }
    void check();
    const timer = setInterval(() => { void check(); }, RECHECK_MS);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [check, enabled, versionKey]);

  return { ...state, recheck: check };
}

const PROJECT_DATA = /\.logicx\/(?:Alternatives\/[^/]+\/)?ProjectData$/;

/** The unsaved changes in words for the Save card; undefined when there is nothing to say beyond the file count. */
export function unsavedSummary(w: Pick<WorkingChanges, 'changes' | 'logic'>): string[] | undefined {
  const touched = w.changes.some((c) => PROJECT_DATA.test(c.path));
  if (!touched || !w.logic) return undefined;
  if (w.logic.length === 0) return ['Logic project changed (no details for this kind of edit yet)'];
  return w.logic.map((l) => l.text);
}
