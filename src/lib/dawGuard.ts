/**
 * Before DAWLab replaces the files of a project (restore, switch, discard,
 * make main), the project must not be open in its DAW: Logic keeps the song in
 * memory and its next save would put the old song back over the new files.
 * `ensureClosedInDaw` asks the main process; when the DAW is running it asks
 * the person through <DawGuardHost/> (in the Layout) and resolves true to go on.
 */
export interface DawGuardRequest {
  projectName: string;
  app: string;
  /** The DAW holds this project's files: it is open there for sure. */
  holdsFiles: boolean;
  /** "restore this version", "discard your changes"… */
  action: string;
  resolve: (go: boolean) => void;
}

type Listener = (req: DawGuardRequest | null) => void;
const listeners = new Set<Listener>();
let current: DawGuardRequest | null = null;

export function subscribeDawGuard(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}

function publish(req: DawGuardRequest | null) {
  current = req;
  for (const l of listeners) l(req);
}

export interface DawState { app: string | null; holdsFiles: boolean }

export const dawState = (projectName: string) =>
  window.ipcRenderer.invoke('daw-project-state', projectName) as Promise<DawState>;

/** Resolves true when it is safe to replace the project's files (or the person says the project is closed). */
export async function ensureClosedInDaw(projectName: string, action: string): Promise<boolean> {
  let state: DawState;
  try { state = await dawState(projectName); } catch { return true; }
  if (!state?.app) return true;
  // No one is listening (tests, a window without the Layout): don't block on a dialog nobody sees.
  if (listeners.size === 0) return !state.holdsFiles;
  return new Promise<boolean>((resolve) => {
    publish({ projectName, app: state.app!, holdsFiles: state.holdsFiles, action, resolve: (go) => { publish(null); resolve(go); } });
  });
}

/** Asks again after the person says they closed it; updates the open request. */
export async function recheckDawGuard(): Promise<void> {
  const req = current;
  if (!req) return;
  let state: DawState;
  try { state = await dawState(req.projectName); } catch { req.resolve(true); return; }
  if (!state?.app) { req.resolve(true); return; }
  publish({ ...req, app: state.app, holdsFiles: state.holdsFiles });
}
