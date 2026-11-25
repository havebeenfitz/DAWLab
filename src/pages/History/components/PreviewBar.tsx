import type React from 'react';
import { Play, Pause, Rewind, Maximize2 } from 'lucide-react';
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
  onOpenFeedback: (e: React.MouseEvent) => void;
}

interface PlayerContentProps {
  commit: Commit;
  versionNumber: number | null;
  player: PreviewPlayer;
  onOpenFeedback: (e: React.MouseEvent) => void;
}

/** Rewind / play controls and the version label, shown once a preview is attached. */
function PreviewPlayerContent({ commit, versionNumber, player, onOpenFeedback }: PlayerContentProps) {
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
          className="play-icon-container fullscreen-btn"
          onClick={onOpenFeedback}
          title="Full screen feedback"
          aria-label="Open full screen feedback"
        >
          <Maximize2 size={18} strokeWidth={1.5} />
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
export function PreviewBar({ activeCommit, versionNumber, player, upload, onOpenFeedback }: Props) {
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
              onOpenFeedback={onOpenFeedback}
            />
          ) : (
            <span>
              {isDraggingFile
                ? "Drop to attach preview"
                : "Drag and drop audio file for preview"}
            </span>
          )}
        </div>
      </div>

      {hasPreview && <PreviewAudio player={player} />}
    </>
  );
}
