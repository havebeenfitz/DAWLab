import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import WaveformCanvas, { type WaveformContextInfo } from "./WaveformCanvas";
import { createAudioEngine, type AudioEngine } from "./utils/audioEngine";

export type { WaveformContextInfo };

export interface AudioPlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo: (time: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPlaying: boolean;
}

interface AudioPlayerProps {
  audioUrl: string;
  selectedRange?: { start: number; end: number } | null;
  pxPerSec: number;
  scrollLeft: number;
  currentTime: number;
  height?: number;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onPeaksReady?: (peaks: Float32Array) => void;
  onSeek?: (time: number) => void;
  onRangeSelect?: (start: number, end: number) => void;
  onClearRange?: () => void;
  onWaveformContextMenu?: (info: WaveformContextInfo) => void;
  loopRange?: { start: number; end: number } | null;
  onLoopRangeChange?: (range: { start: number; end: number } | null) => void;
  onLoadError?: (err: unknown) => void;
  heightScale?: number;
  globalDuration?: number;
  trackLabel?: string;
  isActiveTrack?: boolean;
  onSelectTrack?: () => void;
  onDeleteTrack?: () => void;
  /** Fetchable URL for the same audio, used to decode peaks (see AudioEngine.load). */
  peaksUrl?: string;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  (
    {
      audioUrl,
      selectedRange,
      pxPerSec,
      scrollLeft,
      currentTime,
      height = 300,
      onTimeUpdate,
      onDurationChange,
      onPlayStateChange,
      onPeaksReady,
      onSeek,
      onRangeSelect,
      onClearRange,
      onWaveformContextMenu,
      loopRange,
      onLoopRangeChange,
      onLoadError,
      heightScale = 1,
      globalDuration,
      trackLabel,
      isActiveTrack,
      onSelectTrack,
      onDeleteTrack,
      peaksUrl,
    },
    ref
  ) => {
    const engineRef = useRef<AudioEngine | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [peaks, setPeaks] = useState<Float32Array>(new Float32Array(0));

    // Stable callback refs
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;
    const onPlayStateChangeRef = useRef(onPlayStateChange);
    onPlayStateChangeRef.current = onPlayStateChange;
    const onDurationChangeRef = useRef(onDurationChange);
    onDurationChangeRef.current = onDurationChange;
    const onPeaksReadyRef = useRef(onPeaksReady);
    onPeaksReadyRef.current = onPeaksReady;
    const onLoadErrorRef = useRef(onLoadError);
    onLoadErrorRef.current = onLoadError;

    useImperativeHandle(ref, () => ({
      play: () => {
        engineRef.current?.play();
        setIsPlaying(true);
        onPlayStateChangeRef.current?.(true);
      },
      pause: () => {
        engineRef.current?.pause();
        setIsPlaying(false);
        onPlayStateChangeRef.current?.(false);
      },
      seekTo: (time: number) => {
        engineRef.current?.seekTo(time);
      },
      getCurrentTime: () => engineRef.current?.getCurrentTime() ?? 0,
      getDuration: () => engineRef.current?.getDuration() ?? 0,
      get isPlaying() {
        return isPlaying;
      },
    }));

    // Initialize audio engine
    useEffect(() => {
      const engine = createAudioEngine();
      engineRef.current = engine;

      const unsubTime = engine.onTimeUpdate((t) => {
        onTimeUpdateRef.current?.(t);
      });

      const unsubEnded = engine.onEnded(() => {
        setIsPlaying(false);
        onPlayStateChangeRef.current?.(false);
      });

      engine.load(audioUrl, peaksUrl).then(({ peaks: p, duration: d }) => {
        setPeaks(p);
        onDurationChangeRef.current?.(d);
        onPeaksReadyRef.current?.(p);
      }).catch((err) => {
        onLoadErrorRef.current?.(err);
      });

      return () => {
        unsubTime();
        unsubEnded();
        engine.destroy();
      };
    }, [audioUrl, peaksUrl]);

    const handleSeek = (time: number) => {
      onSeek?.(time);
    };

    return (
      <WaveformCanvas
        peaks={peaks}
        duration={engineRef.current?.getDuration() ?? 0}
        pxPerSec={pxPerSec}
        scrollLeft={scrollLeft}
        currentTime={currentTime}
        selectedRange={selectedRange}
        height={height * heightScale}
        globalDuration={globalDuration}
        trackLabel={trackLabel}
        isActiveTrack={isActiveTrack}
        onSelectTrack={onSelectTrack}
        onDeleteTrack={onDeleteTrack}
        onSeek={handleSeek}
        onRangeSelect={onRangeSelect}
        onClearRange={onClearRange}
        onWaveformContextMenu={onWaveformContextMenu}
        loopRange={loopRange}
        onLoopRangeChange={onLoopRangeChange}
      />
    );
  }
);

export default AudioPlayer;
