import { useCallback, useEffect, useState } from 'react';
import { notify } from '@/lib/notify';
import { onNoticesChanged, onVersionAlerts } from '@/components/Sharing/hub';

export interface VersionNotice {
  id: string;
  folderId: string;
  folderName: string;
  projectName: string;
  commitId: string;
  author: string;
  message: string;
  parallel: boolean;
  /** What changed in the project, in words, once the version is on this Mac. */
  summary?: string;
  at: string;
  read: boolean;
}

export type SoundChoice = 'rooster' | 'system' | 'none' | 'custom';

export interface FeedSnapshot {
  notices: VersionNotice[];
  unread: number;
  enabled: boolean;
  sound: SoundChoice;
  soundFileName: string | null;
  muted: string[];
  folders: Array<{ folderId: string; name: string }>;
}

const EMPTY: FeedSnapshot = { notices: [], unread: 0, enabled: true, sound: 'rooster', soundFileName: null, muted: [], folders: [] };

const warn = (what: string) => (err: unknown) => console.warn(`[notifications] Could not ${what}:`, err);

/**
 * New versions from collaborators, kept by the main process: the list, the
 * unread count and the switches. While DAWLab is in front, each new batch
 * also shows as a toast (in the background, macOS shows a notification).
 */
export function useVersionNotices({ toasts = false }: { toasts?: boolean } = {}) {
  const [feed, setFeed] = useState<FeedSnapshot>(EMPTY);

  useEffect(() => {
    let alive = true;
    window.ipcRenderer.invoke('notifications-get')
      .then((snap: FeedSnapshot) => { if (alive && snap) setFeed(snap); })
      .catch(warn('load notifications'));
    const offChange = onNoticesChanged<FeedSnapshot>((snap) => setFeed(snap));
    const offAlerts = toasts ? onVersionAlerts((alerts) => { for (const a of alerts) notify.info(a.title, a.body); }) : () => {};
    return () => {
      alive = false;
      offChange();
      offAlerts();
    };
  }, [toasts]);

  const call = useCallback((channel: string, what: string, ...args: unknown[]) =>
    window.ipcRenderer.invoke(channel, ...args)
      .then((snap: FeedSnapshot | boolean) => { if (snap && typeof snap === 'object') setFeed(snap); })
      .catch(warn(what)), []);

  return {
    feed,
    open: (id: string) => call('notifications-open', 'open that version', id),
    markAllRead: () => call('notifications-mark-read', 'mark notifications read'),
    setEnabled: (on: boolean) => call('notifications-set-enabled', 'change notifications', on),
    setMuted: (folderId: string, muted: boolean) => call('notifications-set-muted', 'change that folder', folderId, muted),
    setSound: (sound: SoundChoice) => call('notifications-set-sound', 'change the sound', sound),
    chooseSoundFile: () => call('notifications-choose-sound', 'use that sound file'),
    previewSound: () => window.ipcRenderer.invoke('notifications-preview-sound').catch(warn('play the sound')),
  };
}
