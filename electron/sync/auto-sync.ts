import type { TransferProgress } from '../../shared/transfer-progress'
/**
 * Keeps shared folders in sync without anyone pressing a button: once when
 * DAWLab starts, after a version is saved, when a shared project is opened,
 * and when the hub says another member changed the folder (hub-events.ts).
 * There is no timer: nothing is fetched while nobody changes anything.
 * One sync per folder runs at a time; a request while one runs queues one more.
 * Status goes to the renderer on `hub-status`.
 */
import { listLocalSpaces, getSpaceForProject, syncSpace, syncSharedProject, type ProjectSyncResult, type SpaceSyncResult } from './spaces-client'

export type SyncState = 'syncing' | 'synced' | 'error'

export interface SyncStatus {
  folderId: string
  state: SyncState
  message?: string
  /** Files and bytes moving right now, for a progress bar. */
  transfer?: TransferProgress
  lastSync?: string
  error?: string
  /** The folder synced over and over on its own: automatic syncs are slowed down, and "Stop syncing" is offered. */
  looping?: boolean
  /** Automatic syncs of this folder were stopped by hand until "Sync now" (or the next start of DAWLab). */
  paused?: boolean
  result?: Pick<SpaceSyncResult, 'pushedVersions' | 'pulledVersions' | 'addedProjects' | 'uploadedProjects' | 'removedProjects' | 'renamedProjects' | 'failed'>
}

type Emit = (status: SyncStatus) => void

/**
 * Loop guard. Syncs start on their own after saves, change events and
 * retries; a bug that makes two Macs wake each other can sync a folder
 * nonstop (docs/incidents/2026-11-27-sync-loop.md). More than LOOP_LIMIT
 * syncs of one folder within a minute marks it as looping: automatic syncs
 * then run at most once every SLOW_MS, and the folder bar offers to stop
 * them. It calms down after CALM_MS without a burst.
 */
export const LOOP_LIMIT = 6
const LOOP_WINDOW_MS = 60_000
export const SLOW_MS = 2 * 60_000
const CALM_MS = 5 * 60_000
/** When automatic syncs were asked for, per folder. */
const starts = new Map<string, number[]>()
/** When the last sync of a looping folder started. */
const lastRun = new Map<string, number>()
const looping = new Map<string, number>()
const paused = new Set<string>()
const slowed = new Map<string, NodeJS.Timeout>()
const lastStatus = new Map<string, SyncStatus>()

const running = new Map<string, Promise<SpaceSyncResult | null>>()
const again = new Set<string>()
let rawEmit: Emit = () => {}
function emit(status: SyncStatus) {
  const full: SyncStatus = {
    ...status,
    ...(looping.has(status.folderId) ? { looping: true } : {}),
    ...(paused.has(status.folderId) ? { paused: true } : {}),
  }
  lastStatus.set(status.folderId, full)
  rawEmit(full)
}

/** Re-sends a folder's last status with the current loop and pause flags. */
function reemit(folderId: string) {
  const last = lastStatus.get(folderId) ?? { folderId, state: 'synced' as const }
  const { looping: _l, paused: _p, ...rest } = last
  emit(rest)
}

/** Remembers that an automatic sync was asked for; keeps the looping flag up to date. */
function noteAsk(folderId: string) {
  const now = Date.now()
  const recent = [...(starts.get(folderId) ?? []), now].filter((t) => now - t < CALM_MS)
  starts.set(folderId, recent)
  const since = looping.get(folderId)
  if (since !== undefined) {
    // Calm again: hardly any requests over the last few minutes.
    if (now - since > CALM_MS && recent.length <= 3) {
      looping.delete(folderId)
      reemit(folderId)
    }
    return
  }
  if (recent.filter((t) => now - t < LOOP_WINDOW_MS).length > LOOP_LIMIT) {
    looping.set(folderId, now)
    console.warn(`[sync] ${folderId} was asked to sync more than ${LOOP_LIMIT} times in a minute: slowing it down`)
    reemit(folderId)
  }
}

/** Stops automatic syncs of a folder until it is synced by hand. */
export function pauseSpaceSync(folderId: string) {
  paused.add(folderId)
  const t = slowed.get(folderId)
  if (t) clearTimeout(t)
  slowed.delete(folderId)
  retryDone(folderId)
  again.delete(folderId)
  reemit(folderId)
}

/** "Sync now": lifts a stop and the slowdown, and syncs right away. */
export function requestManualSpaceSync(folderId: string) {
  const wasPaused = paused.delete(folderId)
  const wasHeld = looping.delete(folderId) || wasPaused
  starts.delete(folderId)
  const t = slowed.get(folderId)
  if (t) clearTimeout(t)
  slowed.delete(folderId)
  if (wasHeld) reemit(folderId)
  return requestSpaceSync(folderId, true)
}

let timer: NodeJS.Timeout | null = null

/** A sync that failed (offline, the hub restarting, a stalled transfer) tries again later: 30 s, 1 min, 2 min, ... up to 30 min. */
const RETRY_FIRST_MS = 30_000
const RETRY_MAX_MS = 30 * 60_000
const retries = new Map<string, { attempt: number; timer: NodeJS.Timeout | null }>()

function retryLater(folderId: string) {
  const r = retries.get(folderId) ?? { attempt: 0, timer: null }
  if (r.timer) clearTimeout(r.timer)
  const wait = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** r.attempt)
  r.attempt++
  r.timer = setTimeout(() => {
    r.timer = null
    void requestSpaceSync(folderId)
  }, wait)
  retries.set(folderId, r)
}

function retryDone(folderId: string) {
  const r = retries.get(folderId)
  if (r?.timer) clearTimeout(r.timer)
  retries.delete(folderId)
}

/** One sync of every folder shortly after start, for versions saved while offline; after that only on demand. */
export function startAutoSync(onStatus: Emit) {
  rawEmit = onStatus
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    syncAllSpaces()
  }, 5_000)
}

export function stopAutoSync() {
  if (timer) clearTimeout(timer)
  timer = null
  for (const folderId of [...retries.keys()]) retryDone(folderId)
  for (const t of slowed.values()) clearTimeout(t)
  slowed.clear()
  starts.clear()
  lastRun.clear()
  looping.clear()
  paused.clear()
  lastStatus.clear()
}

export function syncAllSpaces() {
  return Promise.all(listLocalSpaces().map((s) => requestSpaceSync(s.folderId)))
}

/** Syncs the shared folder of a project, if it has one. */
export function requestProjectSync(projectName: string) {
  const space = getSpaceForProject(projectName)
  return space ? requestSpaceSync(space.folderId) : Promise.resolve(null)
}

/**
 * Syncs one project of a shared folder now. Waits for a folder sync that is
 * already running, so the two never write the same project at once.
 */
export async function requestSharedProjectSync(projectName: string, onProgress?: (m: string) => void): Promise<ProjectSyncResult> {
  const folderId = getSpaceForProject(projectName)?.folderId
  const busy = folderId ? running.get(folderId) : undefined
  if (busy) await busy.catch(() => null)
  const job = syncSharedProject(projectName, onProgress)
  if (folderId) {
    const tracked = job.then(() => null, () => null)
    running.set(folderId, tracked)
    tracked.finally(() => { if (running.get(folderId) === tracked) running.delete(folderId) })
  }
  return job
}

export function requestSpaceSync(folderId: string, manual = false): Promise<SpaceSyncResult | null> {
  if (paused.has(folderId) && !manual) return Promise.resolve(null)
  if (!manual) noteAsk(folderId)
  const current = running.get(folderId)
  if (current) {
    again.add(folderId)
    return current
  }
  if (looping.has(folderId) && !manual) {
    // Looping: at most one automatic sync every SLOW_MS, however often it is asked for.
    if (slowed.has(folderId)) return Promise.resolve(null)
    const wait = SLOW_MS - (Date.now() - (lastRun.get(folderId) ?? 0))
    if (wait > 0) {
      slowed.set(folderId, setTimeout(() => {
        slowed.delete(folderId)
        void requestSpaceSync(folderId)
      }, wait))
      return Promise.resolve(null)
    }
  }
  lastRun.set(folderId, Date.now())
  const job = runSync(folderId).finally(() => {
    running.delete(folderId)
    if (again.delete(folderId)) requestSpaceSync(folderId)
  })
  running.set(folderId, job)
  return job
}

async function runSync(folderId: string): Promise<SpaceSyncResult | null> {
  emit({ folderId, state: 'syncing' })
  try {
    const result = await syncSpace(folderId, (message, transfer) => emit({ folderId, state: 'syncing', message, ...(transfer ? { transfer } : {}) }))
    if (result.failed.length) retryLater(folderId)
    else retryDone(folderId)
    emit({
      folderId,
      state: result.failed.length ? 'error' : 'synced',
      lastSync: result.space.lastSync,
      error: result.failed.length ? `${result.failed[0].project}: ${result.failed[0].error}` : undefined,
      result: {
        pushedVersions: result.pushedVersions,
        pulledVersions: result.pulledVersions,
        addedProjects: result.addedProjects,
        uploadedProjects: result.uploadedProjects,
        removedProjects: result.removedProjects,
        renamedProjects: result.renamedProjects,
        failed: result.failed,
      },
    })
    return result
  } catch (err) {
    // The hub's "no such member" closes access for good: nothing to retry.
    if ((err as { status?: number })?.status === 404) retryDone(folderId)
    else retryLater(folderId)
    emit({ folderId, state: 'error', error: String((err as Error)?.message ?? err) })
    return null
  }
}
