import { Play } from 'lucide-react';
import { useVersionNotices, type SoundChoice } from '@/components/Notifications/useVersionNotices';

const SOUNDS: Array<{ value: SoundChoice; label: string }> = [
  { value: 'rooster', label: 'Rooster' },
  { value: 'system', label: 'macOS default' },
  { value: 'none', label: 'None' },
  { value: 'custom', label: 'Custom file…' },
];

/**
 * "Notifications": hear when collaborators save versions in shared folders,
 * with a switch per folder. They arrive while DAWLab runs, even with its
 * window closed; nothing arrives while it is quit.
 */
export function NotificationSettings() {
  const { feed, setEnabled, setMuted, setSound, chooseSoundFile, previewSound } = useVersionNotices();
  const pickSound = (value: SoundChoice) => {
    // A custom sound starts with choosing the file; the choice sticks only once there is one.
    if (value === 'custom') void chooseSoundFile();
    else void setSound(value);
  };
  return (
    <div className="form-field" id="notifications">
      <div className="form-field-label" id="notifications-title">Notifications</div>
      <div className="form-field-content notification-settings" role="group" aria-labelledby="notifications-title">
        <label className="ui-check">
          <input
            id="notifications-enabled"
            type="checkbox"
            checked={feed.enabled}
            onChange={(e) => { void setEnabled(e.target.checked); }}
          />
          <span>Tell me when collaborators save versions</span>
        </label>
        {feed.folders.length > 0 && (
          <div className="notification-folders" aria-label="Shared folders">
            {feed.folders.map((f) => (
              <label key={f.folderId} className="ui-check notification-folder">
                <input
                  id={`notifications-folder-${f.folderId}`}
                  type="checkbox"
                  checked={!feed.muted.includes(f.folderId)}
                  disabled={!feed.enabled}
                  onChange={(e) => { void setMuted(f.folderId, !e.target.checked); }}
                />
                <span>{f.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="notification-sound">
          <label htmlFor="notifications-sound">Sound</label>
          <select
            id="notifications-sound"
            className="audio-select"
            value={feed.sound}
            disabled={!feed.enabled}
            onChange={(e) => pickSound(e.target.value as SoundChoice)}
          >
            {SOUNDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.value === 'custom' && feed.soundFileName ? `Custom: ${feed.soundFileName}` : s.label}
              </option>
            ))}
          </select>
          {feed.sound === 'custom' && (
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => { void chooseSoundFile(); }} disabled={!feed.enabled}>Change…</button>
          )}
          <button
            type="button" className="ui-btn ui-btn-sm" aria-label="Preview the sound"
            onClick={() => { void previewSound(); }} disabled={!feed.enabled || feed.sound === 'none'}
          >
            <Play size={12} aria-hidden /> Preview
          </button>
        </div>
        <p className="field-hint">
          DAWLab checks your shared folders about once a minute while it runs, also with its window closed. Nothing arrives while DAWLab is quit. Muted folders still show new versions under the bell in the Library.
        </p>
      </div>
    </div>
  );
}
