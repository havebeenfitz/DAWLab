import { useCallback, useEffect } from 'react';
import { useLibraryPreview } from './useLibraryPreview';

/** Extensions the Files panel can play: what Chromium decodes. */
export const PLAYABLE_EXTENSIONS = ['.wav', '.mp3', '.aif', '.aiff', '.m4a', '.flac', '.ogg'];

export const isPlayableAudio = (path: string) => {
  const dot = path.lastIndexOf('.');
  return dot > 0 && PLAYABLE_EXTENSIONS.includes(path.slice(dot).toLowerCase());
};

export interface VersionAudio {
  /** Path of the file playing now, or null. */
  playingPath: string | null;
  loadingPath: string | null;
  error: string | null;
  toggle: (path: string) => void;
}

/**
 * Plays audio files of one version straight from DAWLab storage, through the
 * app's shared player: one file at a time, stopped when the version changes.
 */
export function useVersionAudio(projectName: string | undefined, commitId: string | undefined): VersionAudio {
  const player = useLibraryPreview();
  const prefix = `${projectName}\u0000${commitId}\u0000`;

  const { toggleSource } = player;
  const toggle = useCallback((path: string) => {
    if (!projectName || !commitId) return;
    void toggleSource(`${prefix}${path}`, () =>
      window.ipcRenderer.invoke('get-version-audio-url', projectName, commitId, path) as Promise<string | null>,
    );
  }, [toggleSource, prefix, projectName, commitId]);

  // A different version: whatever was playing belongs to the old one.
  const { stop } = player;
  useEffect(() => () => { stop(); }, [stop, projectName, commitId]);

  const pathOf = (id: string | null) => (id && id.startsWith(prefix) ? id.slice(prefix.length) : null);
  return {
    playingPath: pathOf(player.playingId),
    loadingPath: pathOf(player.loadingId),
    error: player.status?.kind === 'error' ? player.status.text : null,
    toggle,
  };
}
