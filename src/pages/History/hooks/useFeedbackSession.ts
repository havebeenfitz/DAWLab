import { useMemo, useRef, useState } from "react";
import type React from "react";
import type { Commit } from "@/types/project.types";
import type { FeedbackHandoff, FeedbackVersion } from "@/components/Feedback/FeedbackView";
import { applyAudioSettings } from "@/lib/audioOutput";
import type { usePreviewPlayer } from "./usePreviewPlayer";

type PreviewPlayer = ReturnType<typeof usePreviewPlayer>;

/** Versions on this branch that have a preview, labelled like the player. */
function toFeedbackVersions(commits: Commit[]): FeedbackVersion[] {
  return commits.flatMap((c, i) =>
    c.preview_file
      ? [{
          commitId: String(c.commit_id),
          previewFile: c.preview_file,
          label: c.message ? `Version ${i + 1} · ${c.message}` : `Version ${i + 1}`,
        }]
      : [],
  );
}

/**
 * Full-screen feedback view over the preview player, with gapless handoff of
 * playback in both directions.
 */
export function useFeedbackSession(player: PreviewPlayer, activeCommit: Commit | null, branchCommits: Commit[]) {
  const [feedbackSession, setFeedbackSession] = useState<{ autoPlay: boolean } | null>(null);
  const feedbackOpenRef = useRef(false);
  feedbackOpenRef.current = feedbackSession !== null;
  // Whether the feedback view has taken playback over from this player yet.
  const feedbackTookOverRef = useRef(false);
  const feedbackClosingRef = useRef(false);

  const feedbackVersions = useMemo(() => toFeedbackVersions(branchCommits), [branchCommits]);

  const feedbackVersion = useMemo<FeedbackVersion | null>(() => {
    if (!activeCommit?.preview_file) return null;
    const id = String(activeCommit.commit_id);
    return (
      feedbackVersions.find((v) => v.commitId === id) ?? {
        commitId: id,
        previewFile: activeCommit.preview_file,
        label: activeCommit.message || "Version",
      }
    );
  }, [activeCommit, feedbackVersions]);

  // Open full screen. This player keeps going until the feedback view's audio
  // is running (onTakeover), so there's no gap while it loads.
  const handleOpenFeedback = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!feedbackVersion) return;
    feedbackTookOverRef.current = false;
    feedbackClosingRef.current = false;
    setFeedbackSession({ autoPlay: player.isPlaying });
  };

  const handleFeedbackTakeover = () => {
    feedbackTookOverRef.current = true;
    player.audioRef.current?.pause();
    player.setIsPlaying(false);
  };

  /** Closed while paused: park this player at the overlay's last position. */
  const closePaused = (liveTime: () => number) => {
    setFeedbackSession(null);
    const lastTime = liveTime();
    const el = player.audioRef.current;
    if (el && player.audioUrl) el.currentTime = lastTime;
    else player.pendingSeekRef.current = lastTime;
    player.setCurrentTime(lastTime);
  };

  /** Closed while playing: start this player at the live position, then fix any drift. */
  const resumeFromLiveTime = async (liveTime: () => number) => {
    let el = player.audioRef.current;
    if (!player.audioUrl || !el) {
      const url = await player.loadPreviewUrl();
      el = url ? await player.waitForAudioSrc(url) : null;
    }
    if (!el) return;
    player.pendingSeekRef.current = null;
    el.currentTime = liveTime();
    await applyAudioSettings(el);
    await el.play();
    const live = liveTime();
    if (Math.abs(live - el.currentTime) > 0.08) el.currentTime = live;
    player.setCurrentTime(el.currentTime);
    player.setIsPlaying(true);
  };

  // Leave full screen. If it's playing, start this player at its live position
  // and only close the overlay once ours is running.
  const handleCloseFeedback = async ({ playing, liveTime }: FeedbackHandoff) => {
    if (feedbackClosingRef.current) return;
    // Closed before it took over: this player never stopped, leave it be.
    if (!feedbackTookOverRef.current) {
      setFeedbackSession(null);
      return;
    }
    if (!playing) {
      closePaused(liveTime);
      return;
    }

    feedbackClosingRef.current = true;
    try {
      await resumeFromLiveTime(liveTime);
    } catch (err) {
      console.error("Failed to resume after full screen:", err);
    }
    feedbackClosingRef.current = false;
    setFeedbackSession(null);
  };

  /** Live position when loaded; otherwise where the player is parked. */
  const getFeedbackStartTime = () =>
    player.audioUrl && player.audioRef.current ? player.audioRef.current.currentTime : player.currentTime;

  return {
    feedbackSession,
    feedbackOpenRef,
    feedbackVersion,
    feedbackVersions,
    handleOpenFeedback,
    handleFeedbackTakeover,
    handleCloseFeedback,
    getFeedbackStartTime,
  };
}
