import type { TransferProgress } from '../../shared/transfer-progress'
/**
 * Keeps shared folders in sync without anyone pressing a button: once when
 * DAWLab starts, after a version is saved, when a shared project is opened,
 * and when the hub says another member changed the folder (hub-events.ts).
 * There is no timer: nothing is fetched while nobody changes anything.
 * One sync per folder runs at a time; a request while one runs queues one more.
 * A folder whose syncs loop or hang can be force-stopped (sync-guard.ts); it
 * then stays paused until someone syncs it by hand.
 * Status goes to the renderer on `hub-status`.
 */
import { listLocalSpaces, getSpaceForProject, syncSpace, syncSharedProject, type ProjectSyncResult, type SpaceSyncResult } from './spaces-client'
import { createSyncGuard, type SyncTrouble } from './sync-guard'

export type SyncState = 'syncing' | 'synced' | 'error' | 'paused'

export interface SyncStatus {
  folderId: string
  state: SyncState
  message?: string
  /** Files and bytes moving right now, for a progress bar. */
  transfer?: TransferProgress
  lastSync?: string
  error?: string
  /** Syncs keep restarting or one has stopped moving: the folder offers Force stop. */
  trouble?: SyncTrouble
  result?: Pick<SpaceSyncResult, 'pushedVersions' | 'pulledVersions' | 'addedProjects' | 'uploadedProjects' | 'removedProjects' | 'renamedProjects' | 'failed'>
}

type Emit = (status: SyncStatus) => void

const running = new Map<string, Promise<SpaceSyncResult | null>>()
const again = new Set<string>()
let emit: Emit = () => {}
let timer: NodeJS.Timeout | null = null

let guard = createSyncGuard()
/** Force-stopped folders: nothing syncs them on its own until a sync by hand. */
const paused = new Set<string>()
/** Bumped by a force stop, so a sync still running from before can't report or queue more. */
const generation = new Map<string, number>()
/** How often a running sync is checked for being stuck. */
const STUCK_CHECK_MS = 15_000

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
  emit = onStatus
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
  guard = createSyncGuard()
  paused.clear()
  generation.clear()
}

/**
 * Stops a folder's syncing now: no more automatic syncs, retries or queued
 * runs until the folder is synced by hand. A sync still running is left to
 * finish or time out on its own, but its outcome is ignored.
 */
export function forceStopSync(folderId: string) {
  paused.add(folderId)
  again.delete(folderId)
  retryDone(folderId)
  guard.reset(folderId)
  generation.set(folderId, (generation.get(folderId) ?? 0) + 1)
  running.delete(folderId)
  emit({ folderId, state: 'paused' })
}

export const isSyncPaused = (folderId: string) => paused.has(folderId)

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

/**
 * Syncs a shared folder, or joins the sync already running. Automatic callers
 * get null for a force-stopped folder; `byHand` (Sync now) resumes it.
 */
export function requestSpaceSync(folderId: string, opts: { byHand?: boolean } = {}): Promise<SpaceSyncResult | null> {
  if (opts.byHand && paused.delete(folderId)) guard.reset(folderId)
  if (paused.has(folderId)) return Promise.resolve(null)
  const current = running.get(folderId)
  if (current) {
    again.add(folderId)
    return current
  }
  const gen = generation.get(folderId) ?? 0
  const job = runSync(folderId).finally(() => {
    if ((generation.get(folderId) ?? 0) !== gen) return // force-stopped meanwhile
    running.delete(folderId)
    if (again.delete(folderId)) requestSpaceSync(folderId)
  })
  running.set(folderId, job)
  return job
}

async function runSync(folderId: string): Promise<SpaceSyncResult | null> {
  const gen = generation.get(folderId) ?? 0
  const current = () => (generation.get(folderId) ?? 0) === gen
  const report = (status: SyncStatus) => {
    if (!current()) return
    const trouble = guard.trouble(folderId)
    emit(trouble ? { ...status, trouble } : status)
  }
  guard.started(folderId)
  let last: SyncStatus = { folderId, state: 'syncing' }
  report(last)
  // A sync with no progress for a while turns "stuck" without any event: look now and then.
  const watch = setInterval(() => { if (guard.trouble(folderId) === 'stuck') report(last) }, STUCK_CHECK_MS)
  try {
    const result = await syncSpace(folderId, (message, transfer) => {
      guard.progressed(folderId)
      last = { folderId, state: 'syncing', message, ...(transfer ? { transfer } : {}) }
      report(last)
    })
    guard.ended(folderId)
    if (!current()) return null
    if (result.failed.length) retryLater(folderId)
    else retryDone(folderId)
    report({
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
    guard.ended(folderId)
    if (!current()) return null
    // The hub's "no such member" closes access for good: nothing to retry.
    if ((err as { status?: number })?.status === 404) retryDone(folderId)
    else retryLater(folderId)
    report({ folderId, state: 'error', error: String((err as Error)?.message ?? err) })
    return null
  } finally {
    clearInterval(watch)
  }
}
