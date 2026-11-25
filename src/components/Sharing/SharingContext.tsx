import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { hub, onJoinLink, onSyncStatus, type SharedFolder, type SyncStatus } from './hub';
import { ShareFolderDialog } from './ShareFolderDialog';
import { JoinFolderDialog } from './JoinFolderDialog';
import { ShareProjectDialog } from './ShareProjectDialog';
import { notify } from '@/lib/notify';

interface SharingContextValue {
  /** Shared folders on this Mac, by Library folder id. */
  folders: Record<string, SharedFolder>;
  /** Latest background sync state, by Library folder id. */
  status: Record<string, SyncStatus>;
  refresh: () => Promise<void>;
  shareFolder: (folderId: string, folderName: string) => void;
  shareProject: (projectName: string) => void;
  join: (prefill?: string) => void;
}

const SharingContext = createContext<SharingContextValue | null>(null);

/** Tells the Library to reload, and optionally to show a folder. */
export function announceLibraryChange(folderId?: string) {
  window.dispatchEvent(new CustomEvent('dawlab:library-changed', { detail: { folderId } }));
}

export function SharingProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Record<string, SharedFolder>>({});
  const [status, setStatus] = useState<Record<string, SyncStatus>>({});
  const [shareTarget, setShareTarget] = useState<{ folderId: string; folderName: string } | null>(null);
  const [projectTarget, setProjectTarget] = useState<string | null>(null);
  const [joinPrefill, setJoinPrefill] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await hub.listFolders();
      setFolders(Object.fromEntries(list.map((f) => [f.folderId, f])));
    } catch {
      // No user yet, or the main process is still starting: nothing is shared.
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handOverToFolder = useCallback((folderId: string, folderName: string) => {
    setProjectTarget(null);
    setShareTarget({ folderId, folderName });
  }, []);

  useEffect(() => onSyncStatus((s) => {
    setStatus((prev) => ({ ...prev, [s.folderId]: s }));
    if (s.state === 'syncing') return;
    refresh();
    const added = s.result?.addedProjects ?? [];
    const pulled = s.result?.pulledVersions ?? 0;
    if (added.length || pulled) announceLibraryChange();
    if (s.state === 'synced' && (added.length || pulled)) {
      const parts = [
        added.length ? `${added.length} new project${added.length > 1 ? 's' : ''}` : '',
        pulled ? `${pulled} new version${pulled > 1 ? 's' : ''}` : '',
      ].filter(Boolean);
      notify.info('Shared folder updated', parts.join(', '));
    }
  }), [refresh]);

  // dawlab://join links, both while running and the one that launched the app.
  useEffect(() => {
    const off = onJoinLink((link) => setJoinPrefill(link));
    hub.takePendingJoin().then((link) => { if (link) setJoinPrefill(link); }).catch(() => {});
    return off;
  }, []);

  const value = useMemo<SharingContextValue>(() => ({
    folders,
    status,
    refresh,
    shareFolder: (folderId, folderName) => setShareTarget({ folderId, folderName }),
    shareProject: (projectName) => setProjectTarget(projectName),
    join: (prefill) => setJoinPrefill(prefill ?? ''),
  }), [folders, status, refresh]);

  return (
    <SharingContext.Provider value={value}>
      {children}
      <ShareFolderDialog
        target={shareTarget}
        shared={shareTarget ? folders[shareTarget.folderId] ?? null : null}
        syncStatus={shareTarget ? status[shareTarget.folderId] : undefined}
        onClose={() => setShareTarget(null)}
        onChanged={refresh}
      />
      <ShareProjectDialog
        projectName={projectTarget}
        onClose={() => setProjectTarget(null)}
        onShareFolder={handOverToFolder}
      />
      <JoinFolderDialog
        prefill={joinPrefill}
        onClose={() => setJoinPrefill(null)}
        onJoined={async (folderId) => {
          setJoinPrefill(null);
          await refresh();
          sessionStorage.setItem('dawlab-current-folder', folderId);
          navigate('/');
          announceLibraryChange(folderId);
        }}
      />
    </SharingContext.Provider>
  );
}

export function useSharing(): SharingContextValue {
  const ctx = useContext(SharingContext);
  if (!ctx) throw new Error('useSharing must be used inside <SharingProvider>');
  return ctx;
}

/** Same as useSharing, but returns null outside the provider (for components also used in tests). */
export function useOptionalSharing(): SharingContextValue | null {
  return useContext(SharingContext);
}
