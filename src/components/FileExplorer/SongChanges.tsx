import type { SongDiff, SongInfo } from '../../../shared/song-diff';
import type { VersionAudio } from '@/hooks/useVersionAudio';
import { PlayFileButton } from './PlayFileButton';

/**
 * The song itself: tempo, tracks, key, time signature, sample rate, and what of
 * that changed since the previous version, plus audio files added to or
 * removed from the song.
 */
export function SongChanges({ song, diff, audio }: { song: SongInfo; diff: SongDiff | null; audio?: VersionAudio }) {
  const facts = [
    song.tempo ? `${Math.round(song.tempo * 100) / 100} BPM` : null,
    song.tracks !== undefined ? `${song.tracks} track${song.tracks === 1 ? '' : 's'}` : null,
    song.key ?? null,
    song.timeSignature ?? null,
    song.sampleRate ? `${song.sampleRate / 1000} kHz` : null,
  ].filter(Boolean);
  const changed = diff && (diff.changes.length > 0 || diff.audioAdded.length > 0 || diff.audioRemoved.length > 0);

  return (
    <div className="song-changes" aria-label="Song">
      <div className="song-facts">
        <span className="song-label">Song</span>
        <span>{facts.join(' · ') || 'No song details'}</span>
      </div>
      {changed && (
        <ul className="changes-list song-change-list">
          {diff!.changes.map((c) => (
            <li key={c.field} className="change-row change-modified" title={`${c.label} changed`}>
              <span className="change-mark" aria-label="Changed">~</span>
              <span className="change-path">{c.label}: {c.before} → {c.after}</span>
            </li>
          ))}
          {diff!.audioAdded.map((f) => (
            <li key={`+${f}`} className="change-row change-added" title="Audio file added to the song">
              <span className="change-mark" aria-label="Added to the song">+</span>
              <span className="change-path">{f}</span>
              <PlayFileButton path={f} audio={audio} />
            </li>
          ))}
          {diff!.audioRemoved.map((f) => (
            <li key={`-${f}`} className="change-row change-removed" title="Audio file no longer used in the song">
              <span className="change-mark" aria-label="Removed from the song">−</span>
              <span className="change-path">{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
