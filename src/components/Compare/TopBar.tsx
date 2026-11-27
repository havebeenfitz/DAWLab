import { motion } from "motion/react";
import logoUrl from "./logo.png";
import { formatTimeWithTenths } from "./utils/timeUtils";
import { SkipBack, Play, Pause, Minimize2, Plus } from "lucide-react";
import { FitIcon, MinusIcon, PlusIcon, LoopIcon } from "./Icons";

interface TopBarProps {
  currentTime: number;
  isPlaying: boolean;
  onStop: () => void;
  onTogglePlay: () => void;
  songTitle: string;
  /** The version playing now. */
  versionLabel: string;
  onZoomReset: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  loopRange?: { start: number; end: number } | null;
  onToggleLoop?: () => void;
  showAddTrack?: boolean;
  onAddTrack?: () => void;
  onClose: () => void;
}

export default function TopBar({
  currentTime,
  isPlaying,
  onStop,
  onTogglePlay,
  songTitle,
  versionLabel,
  onZoomReset,
  onZoomOut,
  onZoomIn,
  loopRange,
  onToggleLoop,
  showAddTrack,
  onAddTrack,
  onClose,
}: TopBarProps) {
  const timeParts = formatTimeWithTenths(currentTime);

  return (
    <div className="top-bar">
      <div className="top-bar__left">
        <motion.div
          className="flex items-center justify-center p-1"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
        >
          <img src={logoUrl} alt="DAWLab" className="h-9 w-auto object-contain" />
        </motion.div>
        <div className="top-bar__info">
          <span className="top-bar-title">{songTitle}</span>
          <span className="top-bar-subtitle">{versionLabel}</span>
        </div>
      </div>
      
      <div className="top-bar__center">
        <div className="playback-timer">
          <span className="playback-timer__digits">{timeParts.min}</span>
          <span className="playback-timer__separator">:</span>
          <span className="playback-timer__digits">{timeParts.sec}</span>
          <span className="playback-timer__tenths">.{timeParts.tenths}</span>
        </div>

        <div className="top-bar__transport">
          <motion.button
            className="transport-btn"
            onClick={onStop}
            title="Rewind to start"
            whileTap={{ scale: 0.85, x: -2 }}
          >
            <SkipBack size={20} strokeWidth={2.5} fill="currentColor" />
          </motion.button>

          <button
            className="transport-btn transport-btn--main"
            onClick={onTogglePlay}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause size={24} strokeWidth={2.5} fill="currentColor" />
            ) : (
              <Play size={24} strokeWidth={2.5} fill="currentColor" style={{ marginLeft: 2 }} />
            )}
          </button>

          <div className="top-bar__zoom-group">
            <div className="top-bar__separator" />
            <button className="transport-btn transport-btn--large" onClick={onZoomReset} title="Fit to screen">
              <FitIcon />
            </button>
            <button className="transport-btn transport-btn--large top-bar__zoom-pm" onClick={onZoomOut} title="Zoom out">
              <MinusIcon />
            </button>
            <button className="transport-btn transport-btn--large top-bar__zoom-pm" onClick={onZoomIn} title="Zoom in">
              <PlusIcon />
            </button>
          </div>

          <div className="top-bar__loop-group">
            <div className="top-bar__separator" />
            <button
              className={`transport-btn transport-btn--large${loopRange ? " transport-btn--loop-active" : ""}`}
              onClick={onToggleLoop}
              title={loopRange ? "Clear loop" : "Loop 5s at playhead (or selection)"}
            >
              <LoopIcon />
            </button>
          </div>

        </div>
      </div>

      <div className="top-bar__right">
        <div className="top-bar__tools">
          {showAddTrack && (
            <>
              <button
                type="button"
                className="toolbar-btn toolbar-btn--with-text"
                onClick={onAddTrack}
                title="Add another version to listen to side by side"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>Add version</span>
              </button>
              <div className="top-bar__separator" />
            </>
          )}
        </div>
        <button className="download-btn top-bar__download-btn" onClick={onClose} title="Close (Esc)" aria-label="Close comparison">
          <Minimize2 size={20} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
