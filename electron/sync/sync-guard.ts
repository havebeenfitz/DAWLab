/**
 * Notices a shared folder whose sync has gone wrong in a way a person should
 * be able to stop:
 *
 * - `looping`: syncs keep starting back to back (two apps waking each other,
 *   see docs/incidents/2026-11-27-sync-loop.md).
 * - `stuck`: one sync has shown no progress for a long time.
 *
 * Only then does the folder offer "Force stop". Pure bookkeeping: the caller
 * says when syncs start, move and end, and asks what is wrong.
 */

export type SyncTrouble = 'looping' | 'stuck'

/** This many syncs started within LOOP_WINDOW_MS is a loop, not normal use. */
export const LOOP_MIN_SYNCS = 6
export const LOOP_WINDOW_MS = 60_000
/** A running sync with no progress for this long is stuck (requests time out after 60 s, transfers after 90 s). */
export const STUCK_MS = 120_000

interface FolderRuns {
  starts: number[]
  runningSince: number | null
  lastProgress: number
}

export function createSyncGuard(now: () => number = () => Date.now()) {
  const folders = new Map<string, FolderRuns>()
  const get = (folderId: string) => {
    let f = folders.get(folderId)
    if (!f) {
      f = { starts: [], runningSince: null, lastProgress: 0 }
      folders.set(folderId, f)
    }
    return f
  }

  return {
    started(folderId: string) {
      const f = get(folderId)
      const t = now()
      f.starts = [...f.starts.filter((s) => t - s < LOOP_WINDOW_MS), t]
      f.runningSince = t
      f.lastProgress = t
    },
    progressed(folderId: string) {
      get(folderId).lastProgress = now()
    },
    ended(folderId: string) {
      get(folderId).runningSince = null
    },
    /** What is wrong with the folder's syncing right now, if anything. */
    trouble(folderId: string): SyncTrouble | null {
      const f = folders.get(folderId)
      if (!f) return null
      const t = now()
      if (f.runningSince !== null && t - f.lastProgress >= STUCK_MS) return 'stuck'
      if (f.starts.filter((s) => t - s < LOOP_WINDOW_MS).length >= LOOP_MIN_SYNCS) return 'looping'
      return null
    },
    /** Forget the folder's history (after a force stop, or a sync started by hand). */
    reset(folderId: string) {
      folders.delete(folderId)
    },
  }
}

export type SyncGuard = ReturnType<typeof createSyncGuard>
