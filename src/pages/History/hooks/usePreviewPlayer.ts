import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { Commit } from "@/types/project.types";
import { applyAudioSettings } from "@/lib/audioOutput";

const isUsableDuration = (d: number) => d && d > 0 && d !== Infinity;

/** The hidden <audio> element behind the History preview bar: play/pause, seek, progress. */
export function usePreviewPlayer(activeCommit: Commit | null, passedProject: string | undefined) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressContainerRef = useRef<HTMLDivElement>(null);
  const pendingSeekRef = useRef<number | null>(null);

  // Track progress via onTimeUpdate
  const onAudioTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    if (audio.currentTime > 0 && !isDraggingProgress) {
      setCurrentTime(audio.currentTime);
    }
    if (isUsableDuration(audio.duration)) {
      setDuration(audio.duration);
    }
  };

  const onAudioLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    if (isUsableDuration(audio.duration)) {
      setDuration(audio.duration);
    }
    if (pendingSeekRef.current !== null) {
      audio.currentTime = pendingSeekRef.current;
      setCurrentTime(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
  };

  const onAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const onAudioError = () => {
    if (audioUrl) setIsPlaying(false);
  };

  // Rewind to the start
  const handleRewind = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
    }
  };

  /** Points the player at the active version's preview; null if it's missing. */
  const loadPreviewUrl = async (): Promise<string | null> => {
    if (!activeCommit?.preview_file) return null;
    try {
      const url = await window.ipcRenderer.invoke(
        "get-preview-url",
        passedProject,
        activeCommit.commit_id,
        activeCommit.preview_file,
      );
      // null = the preview file is gone; don't point <audio> at a dead URL.
      if (!url) {
        console.error("Audio preview file not found for commit", activeCommit.commit_id);
        return null;
      }
      setAudioUrl(url);
      return url;
    } catch (err) {
      console.error("Failed to resolve audio preview:", err);
      return null;
    }
  };

  const handleTogglePlay = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeCommit?.preview_file) return;

    if (!isPlaying) {
      if (!audioUrl) {
        if (await loadPreviewUrl()) setIsPlaying(true);
      } else if (audioRef.current) {
        setIsPlaying(true);
      }
    } else if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  /** Resolves once the <audio> element has picked up `url` from a render. */
  const waitForAudioSrc = (url: string) =>
    new Promise<HTMLAudioElement | null>((resolve) => {
      const started = performance.now();
      const check = () => {
        const el = audioRef.current;
        if (el && el.getAttribute("src") === url) resolve(el);
        else if (performance.now() - started > 1000) resolve(null);
        else requestAnimationFrame(check);
      };
      check();
    });

  // Sync isPlaying state with audio element. A failed play() (dead source, output
  // device error) must reset the button rather than leave it stuck on "playing".
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying && audioUrl) {
      let cancelled = false;
      applyAudioSettings(el)
        .then(() => (cancelled ? undefined : el.play()))
        .catch((e) => {
          if (cancelled || e?.name === "AbortError") return;
          console.error("Audio play failed:", e);
          setIsPlaying(false);
        });
      return () => { cancelled = true; };
    }
    el.pause();
  }, [audioUrl, isPlaying]);

  // Cleanup/Reset audio on commit change
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioUrl("");
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [activeCommit?.commit_id]);

  /** Seeks to the pointer's x position on the progress bar. */
  const seekToPointer = (clientX: number, clamp: boolean) => {
    if (!audioRef.current || duration === 0) return;
    const rect = progressContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const rawX = clientX - rect.left;
    const clickX = clamp ? Math.max(0, Math.min(rawX, rect.width)) : rawX;
    const newTime = (clickX / rect.width) * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleProgressMouseDown = (e: React.MouseEvent) => {
    setIsDraggingProgress(true);
    e.stopPropagation();
    seekToPointer(e.clientX, false);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingProgress) return;
      seekToPointer(e.clientX, true);
    };

    const handleMouseUp = () => {
      setIsDraggingProgress(false);
    };

    if (isDraggingProgress) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    // seekToPointer reads duration and refs only; duration is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingProgress, duration]);

  return {
    audioRef,
    progressContainerRef,
    pendingSeekRef,
    audioUrl,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    loadPreviewUrl,
    waitForAudioSrc,
    handleTogglePlay,
    handleRewind,
    handleProgressMouseDown,
    onAudioTimeUpdate,
    onAudioLoadedMetadata,
    onAudioEnded,
    onAudioError,
  };
}
