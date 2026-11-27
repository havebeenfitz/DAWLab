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
  result?: Pick<SpaceSyncResult, 'pushedVersions' | 'pulledVersions' | 'addedProjects' | 'uploadedProjects' | 'removedProjects' | 'renamedProjects' | 'failed'>
}

type Emit = (status: SyncStatus) => void

const running = new Map<string, Promise<SpaceSyncResult | null>>()
const again = new Set<string>()
let emit: Emit = () => {}
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

export function requestSpaceSync(folderId: string): Promise<SpaceSyncResult | null> {
  const current = running.get(folderId)
  if (current) {
    again.add(folderId)
    return current
  }
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
