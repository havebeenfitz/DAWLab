import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import AudioPlayer, { type AudioPlayerHandle, type WaveformContextInfo } from "./WavGraph";
import MultiTrackView, { type MultiTrackHandle, type TrackEntry } from "./MultiTrackView";
import TrackSelectorModal from "./TrackSelectorModal";
import WaveformMinimap from "./WaveformMinimap";
import TopBar from "./TopBar";
import TimelineRuler from "./TimelineRuler";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { useWaveformZoom } from "./useWaveformZoom";
import "./Compare.css";

/**
 * Full-screen A/B player: a version's audio preview with other versions of
 * the alternative stacked under it. Click a track to switch to it at the same
 * position; zoom, loop and seek apply to every track.
 */

/** A version with an audio preview, as offered to the comparison. */
export interface CompareVersion {
  commitId: string;
  previewFile: string;
  label: string;
}

interface CompareViewProps {
  projectName: string;
  /** The version the view opens on; it starts as the active track. */
  version: CompareVersion;
  /** Every version with a preview, oldest first; the others can be added as tracks. */
  versions: CompareVersion[];
  /** The History player's live position; read when this view's audio is ready. */
  getStartTime?: () => number;
  /** Keep playing: History carries on until this view's audio is running. */
  autoPlay?: boolean;
  /** This view's audio is running; the History player can stop now. */
  onTakeover?: () => void;
  /**
   * Leaving full screen. When still playing, this view keeps playing until the
   * parent unmounts it, so the History player can take over without a gap.
   */
  onClose: (handoff: CompareHandoff) => void;
}

export interface CompareHandoff {
  playing: boolean;
  /** Playhead position right now (keeps moving while playing). */
  liveTime: () => number;
}

// Drift beyond this after a player handoff gets corrected with a seek.
const HANDOFF_DRIFT_S = 0.08;
const MOBILE_MAX_WIDTH = 768;
const DEFAULT_LOOP_S = 5;

interface PreviewSources {
  playUrl: string;
  fetchUrl: string;
}

type Range = { start: number; end: number };
type MenuState = { x: number; y: number; range: Range | null };

/** The version to line up against `version` first: the one before it, else the one after. */
export function defaultComparison(version: CompareVersion, versions: CompareVersion[]): CompareVersion | null {
  const i = versions.findIndex((v) => v.commitId === version.commitId);
  if (i === -1) return versions.find((v) => v.commitId !== version.commitId) ?? null;
  return versions[i - 1] ?? versions[i + 1] ?? null;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_MAX_WIDTH);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_MAX_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

export default function CompareView({
  projectName,
  version,
  versions,
  getStartTime,
  autoPlay = false,
  onTakeover,
  onClose,
}: CompareViewProps) {
  const playerRef = useRef<MultiTrackHandle>(null);
  const mobilePlayerRef = useRef<AudioPlayerHandle>(null);
  const isMobile = useIsMobile();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [tracks, setTracks] = useState<TrackEntry[]>([]);
  const [activeTrackId, setActiveTrackId] = useState<string>(version.commitId);
  const [showTrackModal, setShowTrackModal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<Range | null>(null);
  const [loopRange, setLoopRange] = useState<Range | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<Float32Array>(new Float32Array(0));
  // The active track's own duration; `zoom.duration` is the longest track's.
  const [activeDuration, setActiveDuration] = useState(0);

  const zoom = useWaveformZoom(isMobile);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;

  const resolveSources = useCallback(
    (v: CompareVersion): Promise<PreviewSources | null> =>
      window.ipcRenderer.invoke("get-preview-sources", projectName, v.commitId, v.previewFile),
    [projectName],
  );

  const addTrack = useCallback(async (v: CompareVersion): Promise<boolean> => {
    const sources = await resolveSources(v);
    if (!sources) return false;
    setTracks((prev) => prev.some((t) => t.id === v.commitId) ? prev : [...prev, {
      id: v.commitId,
      audioUrl: sources.playUrl,
      peaksUrl: sources.fetchUrl,
      label: v.label,
    }]);
    return true;
  }, [resolveSources]);

  // The version the view was opened on, then the one to compare it with.
  const { commitId: primaryId, previewFile: primaryFile, label: primaryLabel } = version;
  const versionsRef = useRef(versions);
  versionsRef.current = versions;
  useEffect(() => {
    let cancelled = false;
    const primary = { commitId: primaryId, previewFile: primaryFile, label: primaryLabel };
    addTrack(primary)
      .then(async (found) => {
        if (cancelled) return;
        if (!found) {
          setLoadError("This version's audio preview couldn't be found on disk.");
          return;
        }
        const other = defaultComparison(primary, versionsRef.current);
        if (other && !cancelled) await addTrack(other).catch(() => false);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [primaryId, primaryFile, primaryLabel, addTrack]);

  const candidates = useMemo<TrackEntry[]>(
    () => versions
      .filter((v) => !tracks.some((t) => t.id === v.commitId))
      .map((v) => ({ id: v.commitId, audioUrl: "", label: v.label })),
    [versions, tracks],
  );

  const handleAddTrack = useCallback((entry: TrackEntry) => {
    setShowTrackModal(false);
    const v = versions.find((x) => x.commitId === entry.id);
    if (!v) return;
    addTrack(v).then((found) => {
      if (!found) console.error("[Compare] Preview missing for version", v.commitId);
    }).catch((err: unknown) => console.error("[Compare] Failed to resolve preview:", err));
  }, [versions, addTrack]);

  const handleRemoveTrack = useCallback((trackId: string) => {
    setTracks((prev) => {
      const next = prev.filter((t) => t.id !== trackId);
      if (trackId === activeTrackId && next.length > 0) setActiveTrackId(next[0].id);
      return next;
    });
  }, [activeTrackId]);

  // ── Transport ──
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const activePlayer = useCallback(
    () => (isMobileRef.current ? mobilePlayerRef.current : playerRef.current), []);
  const handlePlay = useCallback(() => activePlayer()?.play(), [activePlayer]);
  const handlePause = useCallback(() => activePlayer()?.pause(), [activePlayer]);
  const handleStop = useCallback(() => {
    activePlayer()?.pause();
    activePlayer()?.seekTo(0);
  }, [activePlayer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key !== " " && e.code !== "Space") return;
      e.preventDefault();
      if (isPlaying) handlePause();
      else handlePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, handlePlay, handlePause]);

  // Take over from the History player once the audio is ready: start at its
  // live position, and let it stop only when ours is actually running (see
  // handleTimeUpdate), so there's no silent gap while this view loads.
  const getStartTimeRef = useRef(getStartTime);
  getStartTimeRef.current = getStartTime;
  const onTakeoverRef = useRef(onTakeover);
  onTakeoverRef.current = onTakeover;
  const takeoverFromRef = useRef<number | null>(null);
  const startAppliedRef = useRef(false);
  useEffect(() => {
    if (startAppliedRef.current || zoom.duration <= 0) return;
    startAppliedRef.current = true;
    const start = Math.min(getStartTimeRef.current?.() ?? 0, zoom.duration);
    if (start > 0) activePlayer()?.seekTo(start);
    if (autoPlay) {
      takeoverFromRef.current = start;
      activePlayer()?.play();
    } else {
      onTakeoverRef.current?.();
    }
  }, [zoom.duration, autoPlay, activePlayer]);

  const loopRangeRef = useRef(loopRange);
  loopRangeRef.current = loopRange;
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
    // First sign our audio is moving: catch up with the History player (it kept
    // going while we started), then tell it to stop.
    const from = takeoverFromRef.current;
    if (from !== null && time > from + 0.01) {
      takeoverFromRef.current = null;
      const live = getStartTimeRef.current?.();
      if (live !== undefined && Math.abs(live - time) > HANDOFF_DRIFT_S) activePlayer()?.seekTo(live);
      onTakeoverRef.current?.();
    }
    const loop = loopRangeRef.current;
    if (loop && time >= loop.end) playerRef.current?.seekTo(loop.start);
  }, [activePlayer]);

  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;
  const handleClose = useCallback(() => {
    const playing = isPlayingRef.current;
    if (!playing) activePlayer()?.pause();
    onClose({ playing, liveTime: () => activePlayer()?.getCurrentTime() ?? currentTimeRef.current });
  }, [activePlayer, onClose]);

  // Esc leaves full screen, unless it is dismissing something inside the view.
  const escBlockedRef = useRef(false);
  escBlockedRef.current = menu !== null || showTrackModal;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || escBlockedRef.current) return;
      e.preventDefault();
      handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  // ── Seek, selection, loop ──
  const selectedRangeRef = useRef(selectedRange);
  selectedRangeRef.current = selectedRange;
  const handleSeek = useCallback((time: number) => {
    // With a selection, the first click only dismisses it.
    if (selectedRangeRef.current) {
      setSelectedRange(null);
      return;
    }
    playerRef.current?.seekTo(time);
  }, []);

  const startLoop = useCallback((range: Range) => {
    setLoopRange(range);
    playerRef.current?.seekTo(range.start);
    playerRef.current?.play();
  }, []);

  const handleToggleLoop = useCallback(() => {
    if (loopRange) {
      setLoopRange(null);
      return;
    }
    const range = selectedRangeRef.current;
    if (range) {
      setLoopRange(range);
      playerRef.current?.seekTo(range.start);
    } else {
      const start = currentTimeRef.current;
      setLoopRange({ start, end: start + DEFAULT_LOOP_S });
    }
  }, [loopRange]);

  const handleContextMenu = useCallback((info: WaveformContextInfo) => {
    setMenu({ x: info.x, y: info.y, range: info.type === "selection" ? info.range : null });
  }, []);

  const menuItems = (state: MenuState): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (state.range && !loopRange) {
      const range = state.range;
      items.push({ label: "Loop selection", onClick: () => startLoop(range) });
    }
    if (loopRange) items.push({ label: "Clear loop", onClick: () => setLoopRange(null) });
    return items;
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setHoverTime(zoom.timeAt(e.clientX));
  }, [zoom]);

  const activeLabel = tracks.find((t) => t.id === activeTrackId)?.label ?? primaryLabel;
  const zoomedIn = zoom.duration > 0 && zoom.containerWidth > 0
    && zoom.pxPerSec > (zoom.containerWidth / zoom.duration) * 1.05;

  if (loadError) {
    return (
      <div className="compare-page compare-overlay">
        <div className="compare-titlebar" />
        <div className="compare-error">
          <div className="compare-error__body">
            <h1 className="compare-error__title">Couldn't load this version</h1>
            <p className="compare-error__message">{loadError}</p>
            <p className="compare-error__hint">Try attaching the preview to this version again from the History page.</p>
          </div>
          <button className="toolbar-btn toolbar-btn--with-text" onClick={() => onClose({ playing: false, liveTime: () => 0 })}>
            <span>Back to History</span>
          </button>
        </div>
      </div>
    );
  }

  const sharedWaveProps = {
    onTimeUpdate: handleTimeUpdate,
    onPlayStateChange: setIsPlaying,
    onDurationChange: zoom.handleDurationChange,
    onPeaksReady: setPeaks,
    currentTime,
    selectedRange,
    loopRange,
    onLoopRangeChange: setLoopRange,
    onSeek: handleSeek,
    onRangeSelect: (start: number, end: number) => setSelectedRange({ start, end }),
    onClearRange: () => setSelectedRange(null),
  };

  return (
    <motion.div
      className="h-screen text-white flex flex-col overflow-hidden compare-page compare-overlay"
      role="dialog"
      aria-label={`Compare versions of ${projectName}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      {/* Window drag strip; keeps the macOS traffic lights clear of the top bar */}
      <div className="compare-titlebar" />
      <TopBar
        currentTime={currentTime}
        isPlaying={isPlaying}
        onStop={handleStop}
        onTogglePlay={isPlaying ? handlePause : handlePlay}
        songTitle={projectName}
        versionLabel={activeLabel}
        onZoomReset={zoom.reset}
        onZoomOut={() => zoom.zoomBy(1 / 1.3, currentTime)}
        onZoomIn={() => zoom.zoomBy(1.3, currentTime)}
        loopRange={loopRange}
        onToggleLoop={handleToggleLoop}
        showAddTrack={tracks.length > 0 && candidates.length > 0}
        onAddTrack={() => setShowTrackModal(true)}
        onClose={handleClose}
      />

      {isMobile ? (
        <div className="mobile-layout">
          <div className="mobile-waveform-strip" ref={zoom.containerRef}>
            <AudioPlayer
              ref={mobilePlayerRef}
              audioUrl={tracks[0]?.audioUrl || ""}
              peaksUrl={tracks[0]?.peaksUrl}
              pxPerSec={zoom.pxPerSec}
              scrollLeft={0}
              {...sharedWaveProps}
            />
            {zoom.duration > 0 && zoom.pxPerSec > 0 && (
              <div className="playhead-line" style={{ left: Math.round(currentTime * zoom.pxPerSec) }} />
            )}
          </div>
        </div>
      ) : (
        <div className="compare-layout">
          <div className="compare-main">
            <WaveformMinimap
              peaks={peaks}
              duration={zoom.duration}
              activeDuration={activeDuration > 0 ? activeDuration : zoom.duration}
              pxPerSec={zoom.pxPerSec}
              scrollLeft={zoom.scrollLeft}
              containerWidth={zoom.containerWidth}
              onUpdateView={zoom.setView}
              visible={zoomedIn}
            />
            <div
              ref={zoom.containerRef}
              className="waveform-wrapper waveform-wrapper--compare"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverTime(null)}
            >
              {tracks.length > 0 ? (
                <MultiTrackView
                  ref={playerRef}
                  tracks={tracks}
                  activeTrackId={activeTrackId}
                  isResizing={false}
                  onActiveTrackDuration={setActiveDuration}
                  pxPerSec={zoom.pxPerSec}
                  scrollLeft={zoom.scrollLeft}
                  onWaveformContextMenu={handleContextMenu}
                  onActiveTrackChange={setActiveTrackId}
                  onDeleteTrack={handleRemoveTrack}
                  {...sharedWaveProps}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">Loading audio...</div>
              )}
              <TimelineRuler
                duration={zoom.duration}
                scrollLeft={zoom.scrollLeft}
                pxPerSec={zoom.pxPerSec}
                onSeek={handleSeek}
              />
              {hoverTime !== null && zoom.pxPerSec > 0 && (
                <div
                  className="timeline-hover-indicator"
                  style={{ left: Math.round(hoverTime * zoom.pxPerSec - zoom.scrollLeft) }}
                />
              )}
              {zoom.duration > 0 && zoom.pxPerSec > 0 && (
                <div
                  className="playhead-line"
                  style={{ left: Math.round(currentTime * zoom.pxPerSec - zoom.scrollLeft) }}
                />
              )}
            </div>
            {tracks.length > 1 && (
              <p className="compare-hint">Click a track to switch to it at the same spot. Space plays and pauses.</p>
            )}
          </div>

          <AnimatePresence>
            {menu && menuItems(menu).length > 0 && (
              <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />
            )}
          </AnimatePresence>
        </div>
      )}

      {showTrackModal && (
        <TrackSelectorModal
          availableTracks={candidates}
          onAdd={handleAddTrack}
          onClose={() => setShowTrackModal(false)}
        />
      )}
    </motion.div>
  );
}
