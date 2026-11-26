/**
 * A question with two answers, asked from anywhere (hooks, handlers) and shown
 * by <ConfirmHost/> in the Layout. Resolves true for the confirm button.
 */
export interface ConfirmRequest {
  title: string;
  /** One paragraph above the list. */
  message: string;
  /** Lines shown as a list, e.g. what a save would lose. */
  items?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** The confirm button does something that can't be taken back easily. */
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

type Listener = (req: ConfirmRequest | null) => void;
const listeners = new Set<Listener>();
let current: ConfirmRequest | null = null;

export function subscribeConfirm(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}

function publish(req: ConfirmRequest | null) {
  current = req;
  for (const l of listeners) l(req);
}

/** With no host on screen (tests) the answer is `fallback`. */
export function askConfirm(req: Omit<ConfirmRequest, 'resolve'>, fallback = true): Promise<boolean> {
  if (listeners.size === 0) return Promise.resolve(fallback);
  return new Promise((resolve) => publish({ ...req, resolve: (ok) => { publish(null); resolve(ok); } }));
}
