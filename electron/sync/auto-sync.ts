import type { TransferProgress } from '../../shared/transfer-progress'
/**
 * Keeps shared folders in sync without anyone pressing a button: every few
 * minutes, after a version is saved, and when a shared project is opened.
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
  result?: Pick<SpaceSyncResult, 'pushedVersions' | 'pulledVersions' | 'addedProjects' | 'uploadedProjects' | 'removedProjects' | 'failed'>
}

type Emit = (status: SyncStatus) => void

const INTERVAL_MS = 5 * 60 * 1000

const running = new Map<string, Promise<SpaceSyncResult | null>>()
const again = new Set<string>()
let emit: Emit = () => {}
let timer: NodeJS.Timeout | null = null

export function startAutoSync(onStatus: Emit, intervalMs = INTERVAL_MS) {
  emit = onStatus
  if (timer) clearInterval(timer)
  timer = setInterval(() => { syncAllSpaces() }, intervalMs)
  setTimeout(() => { syncAllSpaces() }, 5_000)
}

export function stopAutoSync() {
  if (timer) clearInterval(timer)
  timer = null
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
        failed: result.failed,
      },
    })
    return result
  } catch (err) {
    emit({ folderId, state: 'error', error: String((err as Error)?.message ?? err) })
    return null
  }
}
