import type React from 'react';
import { Play, Pause, Rewind, GitCompareArrows } from 'lucide-react';
import type { Commit } from '@/types/project.types';
import type { usePreviewPlayer } from '../hooks/usePreviewPlayer';
import type { usePreviewUpload } from '../hooks/usePreviewUpload';

type PreviewPlayer = ReturnType<typeof usePreviewPlayer>;
type PreviewUpload = ReturnType<typeof usePreviewUpload>;

interface Props {
  activeCommit: Commit | null;
  versionNumber: number | null;
  player: PreviewPlayer;
  upload: PreviewUpload;
  /** Another version of this alternative has a preview too. */
  canCompare: boolean;
  onCompare: () => void;
}

interface PlayerContentProps {
  commit: Commit;
  versionNumber: number | null;
  player: PreviewPlayer;
  canCompare: boolean;
  onCompare: () => void;
}

/** Rewind / play controls and the version label, shown once a preview is attached. */
function PreviewPlayerContent({ commit, versionNumber, player, canCompare, onCompare }: PlayerContentProps) {
  return (
    <div className="preview-player-container">
      <div className="preview-player-content">
        <div className="player-controls">
          <button
            className="play-icon-container rewind-btn"
            onClick={player.handleRewind}
            title="Rewind 10s"
          >
            <Rewind size={20} strokeWidth={1.5} />
          </button>
          <button
            className="play-icon-container"
            onClick={player.handleTogglePlay}
          >
            {player.isPlaying ? (
              <Pause size={24} strokeWidth={1.5} />
            ) : (
              <Play size={24} strokeWidth={1.5} />
            )}
          </button>
        </div>
        <div className="player-info">
          <span className="version-label">
            Version {versionNumber}
          </span>
          <span className="commit-message-preview">
            {commit.message}
          </span>
        </div>
        <button
          type="button"
          className="compare-btn"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onCompare(); }}
          disabled={!canCompare}
          title={canCompare
            ? "Listen to this version and others side by side"
            : "Attach a preview to another version to compare them"}
        >
          <GitCompareArrows size={16} strokeWidth={2} aria-hidden />
          <span>Compare versions</span>
        </button>
      </div>
    </div>
  );
}

/** Hidden <audio> element plus the seekable progress bar under the dropzone. */
function PreviewAudio({ player }: { player: PreviewPlayer }) {
  const { duration, currentTime } = player;
  return (
    <>
      <audio
        ref={player.audioRef}
        src={player.audioUrl}
        preload="auto"
        onTimeUpdate={player.onAudioTimeUpdate}
        onLoadedMetadata={player.onAudioLoadedMetadata}
        onDurationChange={player.onAudioLoadedMetadata}
        onEnded={player.onAudioEnded}
        onError={player.onAudioError}
        style={{ display: "none" }}
      />
      <div
        className="audio-progress-container"
        ref={player.progressContainerRef}
        onMouseDown={player.handleProgressMouseDown}
      >
        <div
          className="audio-progress-bar"
          style={{
            width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
          }}
        />
      </div>
    </>
  );
}

/** Preview dropzone at the bottom of a project: drop audio to attach it, click to play. */
export function PreviewBar({ activeCommit, versionNumber, player, upload, canCompare, onCompare }: Props) {
  const { isDraggingFile, isUploadingPreview } = upload;
  const hasPreview = !!activeCommit?.preview_file;
  return (
    <>
      <div className={`preview-dropzone-container ${isDraggingFile ? 'dragging' : ''} ${isUploadingPreview ? 'uploading' : ''} ${hasPreview ? 'has-preview' : ''}`}>
        <div
          className="preview-dropzone"
          onDragOver={upload.handleDragOver}
          onDragLeave={upload.handleDragLeave}
          onDrop={upload.handlePreviewDrop}
          onClick={(e) => {
            // Only toggle if we have a preview file and we're not dragging
            if (hasPreview && !isDraggingFile) {
              player.handleTogglePlay(e);
            }
          }}
        >
          {isUploadingPreview ? (
            <span className="preview-uploading-label">Attaching preview...</span>
          ) : activeCommit?.preview_file && !isDraggingFile ? (
            <PreviewPlayerContent
              commit={activeCommit}
              versionNumber={versionNumber}
              player={player}
              canCompare={canCompare}
              onCompare={onCompare}
            />
          ) : (
            <span>
              {isDraggingFile
                ? "Drop to attach preview"
                : "Drop an audio file here to attach a preview"}
            </span>
          )}
        </div>
      </div>

      {hasPreview && <PreviewAudio player={player} />}
    </>
  );
}
