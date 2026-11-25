/**
 * App-wide notices, shown by <Toaster/> in the Layout. Use instead of alert():
 * notices don't block the app and explain what to do next.
 */
export type NoticeKind = 'info' | 'success' | 'error';

export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  detail?: string;
  /** Milliseconds; 0 keeps it until dismissed. */
  timeout: number;
}

type Listener = (notices: Notice[]) => void;

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function publish(next: Notice[]) {
  notices = next;
  for (const l of listeners) l(notices);
}

export function subscribeNotices(listener: Listener): () => void {
  listeners.add(listener);
  listener(notices);
  return () => { listeners.delete(listener); };
}

export function dismissNotice(id: number) {
  publish(notices.filter((n) => n.id !== id));
}

function push(kind: NoticeKind, title: string, detail?: string, timeout?: number): number {
  const id = nextId++;
  const notice: Notice = { id, kind, title, detail, timeout: timeout ?? (kind === 'error' ? 8000 : 4000) };
  publish([...notices.slice(-3), notice]);
  if (notice.timeout > 0) setTimeout(() => dismissNotice(id), notice.timeout);
  return id;
}

/** Strips Electron's "Error invoking remote method '…': Error:" prefix. */
export function errorMessage(err: unknown): string {
  return String((err as Error)?.message ?? err ?? 'Something went wrong.')
    .replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    .replace(/^Error: /, '');
}

export const notify = {
  info: (title: string, detail?: string) => push('info', title, detail),
  success: (title: string, detail?: string) => push('success', title, detail),
  error: (title: string, detail?: unknown) =>
    push('error', title, detail === undefined ? undefined : typeof detail === 'string' ? detail : errorMessage(detail)),
};
