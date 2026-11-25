import { Loader2, Pause, Play } from 'lucide-react';
import { isPlayableAudio, type VersionAudio } from '@/hooks/useVersionAudio';

/** Small play/pause for an audio file of the version being looked at. Renders nothing for other files. */
export function PlayFileButton({ path, audio }: { path: string; audio?: VersionAudio }) {
  if (!audio || !isPlayableAudio(path)) return null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const playing = audio.playingPath === path;
  const loading = audio.loadingPath === path;
  return (
    <button
      type="button"
      className={`file-play-btn ${playing ? 'is-playing' : ''}`}
      onClick={(e) => { e.stopPropagation(); audio.toggle(path); }}
      aria-label={playing ? `Pause ${name}` : `Play ${name}`}
      title={playing ? 'Pause' : 'Play this version of the file'}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : playing ? <Pause size={13} /> : <Play size={13} />}
    </button>
  );
}
