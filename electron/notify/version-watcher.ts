/**
 * Looks at shared folders on the hub when the hub says something changed
 * there (or when its event stream reconnects): the folder's project list
 * (with each project's "last written" stamp) and, only for projects that
 * changed, their version history. No files are downloaded. New versions by
 * other people become notices; the caller shows them.
 */
import fs from 'fs'
import path from 'path'
import { writeJsonSync } from '../dawvcs/core/fs-utils'
import { addNotices, alertsFor, parseFeed, readProject, type Alert, type FeedState, type VersionNotice } from './version-feed'

export interface WatchedSpace { folderId: string; name: string }
export interface WatchedProject { id: string; name: string; updatedAt?: string }

export interface WatcherDeps {
  spaces: () => WatchedSpace[]
  /** The folder's projects on the hub, with their "last written" stamps. */
  listProjects: (folderId: string) => Promise<WatchedProject[]>
  /** One project's version history on the hub (no files). */
  readLog: (folderId: string, hubProjectId: string) => Promise<{ branches?: any[] }>
  /** Who this Mac is: versions by them are never announced. */
  me: () => string
  load: () => FeedState
  save: (state: FeedState) => void
  now?: () => Date
}

export interface CheckResult {
  added: VersionNotice[]
  alerts: Alert[]
  /** Shared folders with something new, so their sync can pull it. */
  changedFolders: string[]
}

/** One look at every shared folder. A folder the hub can't be reached for is skipped until next time. */
export async function checkForNewVersions(deps: WatcherDeps): Promise<CheckResult> {
  const now = deps.now?.() ?? new Date()
  const me = deps.me()
  let state = deps.load()
  const fresh: VersionNotice[] = []
  const changedFolders: string[] = []
  for (const space of deps.spaces()) {
    let projects: WatchedProject[]
    try {
      projects = await deps.listProjects(space.folderId)
    } catch (err) {
      console.warn(`[notify] Could not check ${space.name}:`, (err as Error)?.message ?? err)
      continue
    }
    for (const project of projects) {
      const cursor = state.cursors[project.id]
      if (cursor && project.updatedAt && cursor.updatedAt === project.updatedAt) continue
      let log: { branches?: any[] }
      try {
        log = await deps.readLog(space.folderId, project.id)
      } catch (err) {
        console.warn(`[notify] Could not read ${project.name}:`, (err as Error)?.message ?? err)
        continue
      }
      const read = readProject(cursor, log, { folderId: space.folderId, folderName: space.name, hubProjectId: project.id, projectName: project.name }, me, project.updatedAt, now)
      state = { ...state, cursors: { ...state.cursors, [project.id]: read.cursor } }
      if (read.notices.length) {
        fresh.push(...read.notices)
        if (!changedFolders.includes(space.folderId)) changedFolders.push(space.folderId)
      }
    }
  }
  const { state: next, added } = addNotices(state, fresh)
  deps.save(next)
  return { added, alerts: alertsFor(next, added), changedFolders }
}

/** The feed kept in the user's DAWLab folder (notifications.json). */
export function feedStore(userDir: () => string) {
  const file = () => path.join(userDir(), 'notifications.json')
  return {
    load: (): FeedState => {
      try {
        return parseFeed(JSON.parse(fs.readFileSync(file(), 'utf8')))
      } catch {
        return parseFeed(null)
      }
    },
    save: (state: FeedState) => {
      fs.mkdirSync(userDir(), { recursive: true })
      writeJsonSync(file(), state)
    },
  }
}
