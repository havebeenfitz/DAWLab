import { useMemo, useRef, useState } from "react";
import type { Commit } from "@/types/project.types";
import type { CompareHandoff, CompareVersion } from "@/components/Compare/CompareView";
import { applyAudioSettings } from "@/lib/audioOutput";
import type { usePreviewPlayer } from "./usePreviewPlayer";

type PreviewPlayer = ReturnType<typeof usePreviewPlayer>;

/** Versions on this branch that have a preview, oldest first, labelled like the player. */
export function toCompareVersions(commits: Commit[]): CompareVersion[] {
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

interface CompareSession {
  commitId: string;
  /** Carry on playing (the History player was playing this version). */
  autoPlay: boolean;
  /** Opened on the version the History player has loaded, so it can hand over. */
  handsOver: boolean;
}

/**
 * The full-screen "Compare versions" view over the History player. Opened on
 * the version the player has loaded, playback hands over without a gap in
 * both directions; opened on another version, it starts from the top.
 */
export function useCompareSession(player: PreviewPlayer, activeCommit: Commit | null, branchCommits: Commit[]) {
  const [session, setSession] = useState<CompareSession | null>(null);
  const openRef = useRef(false);
  openRef.current = session !== null;
  // Whether the compare view has taken playback over from this player yet.
  const tookOverRef = useRef(false);
  const closingRef = useRef(false);

  const versions = useMemo(() => toCompareVersions(branchCommits), [branchCommits]);

  const version = useMemo<CompareVersion | null>(() => {
    if (!session) return null;
    const found = versions.find((v) => v.commitId === session.commitId);
    if (found) return found;
    // A version from another alternative (e.g. a parallel version).
    const commit = activeCommit && String(activeCommit.commit_id) === session.commitId ? activeCommit : null;
    return commit?.preview_file
      ? { commitId: session.commitId, previewFile: commit.preview_file, label: commit.message || "Version" }
      : null;
  }, [session, versions, activeCommit]);

  const canCompare = (commitId: string | null | undefined) =>
    !!commitId && (versions.some((v) => v.commitId === commitId)
      || (!!activeCommit?.preview_file && String(activeCommit.commit_id) === commitId));

  /** Opens the comparison on `commitId`, or on the version the player has loaded. */
  const open = (commitId?: string) => {
    const id = commitId ?? (activeCommit ? String(activeCommit.commit_id) : null);
    if (!id || !canCompare(id)) return;
    const handsOver = !!activeCommit && String(activeCommit.commit_id) === id;
    tookOverRef.current = false;
    closingRef.current = false;
    setSession({ commitId: id, autoPlay: handsOver && player.isPlaying, handsOver });
  };

  const handleTakeover = () => {
    tookOverRef.current = true;
    player.audioRef.current?.pause();
    player.setIsPlaying(false);
  };

  /** Closed while paused: park this player at the view's last position. */
  const closePaused = (liveTime: () => number) => {
    setSession(null);
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

  // Leave full screen. If it's playing the player's version, start this player
  // at its live position and only close the view once ours is running.
  const handleClose = async ({ playing, liveTime }: CompareHandoff) => {
    if (closingRef.current) return;
    // Closed before it took over: this player never stopped, leave it be.
    // Another version than the player's: nothing to hand back.
    if (!tookOverRef.current || !session?.handsOver) {
      setSession(null);
      return;
    }
    if (!playing) {
      closePaused(liveTime);
      return;
    }
    closingRef.current = true;
    try {
      await resumeFromLiveTime(liveTime);
    } catch (err) {
      console.error("Failed to resume after comparing versions:", err);
    }
    closingRef.current = false;
    setSession(null);
  };

  /** Live position when loaded; otherwise where the player is parked. Zero for another version. */
  const getStartTime = () => {
    if (!session?.handsOver) return 0;
    return player.audioUrl && player.audioRef.current ? player.audioRef.current.currentTime : player.currentTime;
  };

  return {
    session,
    openRef,
    version,
    versions,
    canCompare,
    open,
    handleTakeover,
    handleClose,
    getStartTime,
  };
}
