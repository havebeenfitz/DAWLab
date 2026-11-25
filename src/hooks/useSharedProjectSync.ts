import { useCallback, useEffect, useRef, useState } from 'react';
import { hub, onSyncStatus, describeSync, onHubProgress } from '@/components/Sharing/hub';
import type { TransferProgress } from '../../shared/transfer-progress';
import { notify, errorMessage } from '@/lib/notify';

export interface SharedProjectSync {
  /** Versions on the hub this Mac doesn't have yet. */
  incoming: number;
  pulling: boolean;
  /** Files and bytes moving during a Pull. */
  transfer: TransferProgress | null;
  pull: () => Promise<void>;
}

/**
 * For a project in a shared folder: how many new versions others have put on
 * the hub (checked on open, when the window comes back into focus, and after
 * background syncs), and a Pull that gets them and sends this Mac's new ones.
 */
export function useSharedProjectSync(
  projectName: string | undefined,
  folderId: string | undefined,
  onPulled: () => Promise<void> | void,
): SharedProjectSync {
  const [incoming, setIncoming] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [transfer, setTransfer] = useState<TransferProgress | null>(null);
  const pullingRef = useRef(false);
  const onPulledRef = useRef(onPulled);
  onPulledRef.current = onPulled;

  const check = useCallback(async () => {
    if (!projectName || !folderId || pullingRef.current) return;
    try {
      setIncoming(await hub.incomingVersions(projectName));
    } catch {
      setIncoming(0); // offline or no access: nothing to announce
    }
  }, [projectName, folderId]);

  useEffect(() => {
    setIncoming(0);
    if (!folderId) return;
    void check();
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    const off = onSyncStatus((s) => {
      if (s.folderId !== folderId || s.state === 'syncing') return;
      if (s.result?.pulledVersions) void onPulledRef.current();
      void check();
    });
    return () => { window.removeEventListener('focus', onFocus); off(); };
  }, [folderId, check]);

  const pull = useCallback(async () => {
    if (!projectName || !folderId || pullingRef.current) return;
    pullingRef.current = true;
    setPulling(true);
    setTransfer(null);
    const off = onHubProgress(projectName, (_m, t) => { if (t) setTransfer(t); });
    try {
      const r = await hub.syncProjectNow(projectName);
      await onPulledRef.current();
      notify.success(`“${projectName}” synced`, describeSync({ ok: true, pulledVersions: r.pulledVersions, pushedVersions: r.pushedVersions }));
      setIncoming(0);
    } catch (err) {
      notify.error(`Couldn’t sync “${projectName}”`, errorMessage(err));
    } finally {
      off();
      setTransfer(null);
      pullingRef.current = false;
      setPulling(false);
      void check();
    }
  }, [projectName, folderId, check]);

  return { incoming, pulling, transfer, pull };
}
