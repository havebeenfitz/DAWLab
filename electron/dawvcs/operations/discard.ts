/**
 * "Discard changes": puts the project folder back to the last saved version of
 * the alternative you are on. Files that would be overwritten or removed are
 * first moved, together, to the macOS Trash, so nothing is lost for good.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { loadLocalProjectLog, saveProjectLog } from '../core/log'
import { getCommitFileMap, getCommitPath } from '../core/commits'
import { getCasPath } from '../core/cas'
import { getProjectPath } from '../core/registry'
import { getProjectStorageDirs } from '../core/storage-location'
import { getAllFiles } from '../core/fs-utils'
import { isNoisePath } from '../core/noise'
import { parentForNewVersion } from './commit'
import { saveUnsavedWork } from './guard'
import { trashFiles, pruneEmptyDirs, type TrashFn } from '../core/trash'

export type WorkingChangeKind = 'added' | 'modified' | 'deleted'

export interface WorkingChange {
  /** Project-relative, `/`-separated. */
  path: string
  kind: WorkingChangeKind
}

export interface WorkingChanges {
  /** The version the folder would go back to; null when nothing is saved yet. */
  baseCommitId: string | null
  changes: WorkingChange[]
}

export interface DiscardResult {
  baseCommitId: string
  restored: number
  removed: number
  /** Name of the folder in the Trash holding what was replaced, when anything was. */
  trashedAs: string | null
}

export type { TrashFn } from '../core/trash'

// Hashes of files we've already read, so checking again only reads what changed.
const hashCache = new Map<string, { size: number; mtimeMs: number; hash: string }>()

async function hashFile(full: string, stat: fs.Stats): Promise<string> {
  const cached = hashCache.get(full)
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.hash
  const hash = await new Promise<string>((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(full).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  })
  hashCache.set(full, { size: stat.size, mtimeMs: stat.mtimeMs, hash })
  return hash
}

const byPath = (a: WorkingChange, b: WorkingChange) => a.path.localeCompare(b.path)

/** The project, its folder and storage, and the files of version `baseCommitId` (noise and folders left out). */
function projectState(projectName: string, pickBase: (log: any) => string | null) {
  const log = loadLocalProjectLog(projectName)
  if (!log) throw new Error(`Project '${projectName}' not found`)
  const projectPath = getProjectPath(projectName)
  if (!projectPath || projectPath === 'NA' || projectPath === '/') throw new Error(`'${projectName}' has no project folder on this Mac.`)
  const { casDir, commitsDir } = getProjectStorageDirs(projectName)
  const baseCommitId = pickBase(log)
  const files = new Map<string, string>()
  if (baseCommitId) {
    for (const e of getCommitFileMap(projectName, baseCommitId, commitsDir)) {
      // Older versions may still list noise; folders ("empty") are not files.
      if (e.hash && e.hash !== 'empty' && !isNoisePath(e.path)) files.set(e.path, e.hash)
    }
  }
  return { log, projectPath, casDir, commitsDir, baseCommitId, files }
}

/** The last saved version of the alternative you are on: what Discard goes back to. */
const lastSaved = (log: any) => parentForNewVersion(log, log.current_branch || 'main') ?? null

/** The version the folder was last put on (any alternative), else the last saved one: what "unsaved" means. */
export const checkedOutVersion = (log: any): string | null => {
  const id = log.lastCheckout?.commitId ? String(log.lastCheckout.commitId) : null
  const known = id && (log.branches ?? []).some((b: any) => (b.commits ?? []).some((c: any) => String(c.commit_id) === id))
  return known ? id : lastSaved(log)
}

const savedState = (projectName: string) => projectState(projectName, lastSaved)

/** Files that differ between the folder and `files` (a version's), ignoring noise. */
async function compare(projectPath: string, ignored: string[], casDir: string, files: Map<string, string>): Promise<WorkingChange[]> {
  const working = fs.existsSync(projectPath) ? await getAllFiles(projectPath, ignored) : {}
  const changes: WorkingChange[] = []
  for (const [rel, full] of Object.entries(working)) {
    if (full === 'empty' || isNoisePath(rel)) continue
    const saved = files.get(rel)
    if (!saved) { changes.push({ path: rel, kind: 'added' }); continue }
    const stat = fs.statSync(full)
    // Different size means different content: no need to read the file.
    let savedSize = -1
    try { savedSize = fs.statSync(getCasPath(saved, casDir)).size } catch { /* not stored: compare by hash */ }
    if (savedSize >= 0 && savedSize !== stat.size) { changes.push({ path: rel, kind: 'modified' }); continue }
    if ((await hashFile(full, stat)) !== saved) changes.push({ path: rel, kind: 'modified' })
  }
  for (const rel of files.keys()) {
    if (!(rel in working)) changes.push({ path: rel, kind: 'deleted' })
  }
  return changes.sort(byPath)
}

/** What differs between the project folder and the last saved version, ignoring noise. */
export async function getWorkingChanges(projectName: string): Promise<WorkingChanges> {
  const { log, projectPath, casDir, baseCommitId, files } = savedState(projectName)
  if (!baseCommitId) return { baseCommitId: null, changes: [] }
  return { baseCommitId, changes: await compare(projectPath, log.ignoredFiles || [], casDir, files) }
}

/** What differs from the version the folder was put on; with no version yet, every file counts. */
export async function getUnsavedChanges(projectName: string): Promise<WorkingChanges> {
  const { log, projectPath, casDir, baseCommitId, files } = projectState(projectName, checkedOutVersion)
  return { baseCommitId, changes: await compare(projectPath, log.ignoredFiles || [], casDir, files) }
}

/**
 * Puts the folder back to `expectedBaseId` (the version the user confirmed).
 * Added and changed files are moved, as one folder, to the Trash; then changed
 * and deleted files are restored from the saved version. If the Trash step
 * fails nothing in the project has changed.
 */
export async function discardWorkingChanges(projectName: string, expectedBaseId: string, trash: TrashFn): Promise<DiscardResult> {
  const { log, projectPath, casDir, commitsDir, baseCommitId, files } = savedState(projectName)
  if (!baseCommitId) throw new Error('There is no saved version to go back to yet.')
  if (baseCommitId !== expectedBaseId) throw new Error('The saved version changed in the meantime. Look at the changes again.')
  const { changes } = await getWorkingChanges(projectName)

  // Everything we will restore must be in storage before touching anything.
  for (const c of changes) {
    if (c.kind !== 'added' && !fs.existsSync(getCasPath(files.get(c.path)!, casDir))) {
      throw new Error(`The saved copy of ${c.path} is missing, so it can't be restored. Nothing was changed.`)
    }
  }

  // Like any switch: your current files are kept as a version too, so Discard can be undone from History.
  await saveUnsavedWork(projectName, 'the last saved version')
  // That version is not where the folder goes back to.
  const restoreTo = loadLocalProjectLog(projectName)
  saveProjectLog(projectName, { ...restoreTo, lastCheckout: log.lastCheckout ?? null })

  const replaced = changes.filter((c) => c.kind !== 'deleted').map((c) => c.path)
  let trashedAs: string | null = null
  try {
    trashedAs = await trashFiles(projectPath, replaced, 'discarded changes', trash)
  } catch (err) {
    throw new Error(`Couldn't move your current files to the Trash, so nothing was changed. ${String((err as Error)?.message ?? '').replace(/^Couldn't move files to the Trash, so nothing was changed\.\s*/, '')}`.trim())
  }

  let restored = 0
  for (const c of changes) {
    if (c.kind === 'added') continue
    const to = path.join(projectPath, c.path)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(getCasPath(files.get(c.path)!, casDir), to)
    restored++
  }
  pruneEmptyDirs(projectPath, changes.filter((c) => c.kind === 'added').map((c) => c.path))

  // The unsaved snapshot described what was just discarded.
  if (log.draft?.commit_id) {
    try { fs.rmSync(getCommitPath(projectName, log.draft.commit_id, commitsDir), { recursive: true, force: true }) } catch { /* ignore */ }
  }
  const next = { ...loadLocalProjectLog(projectName), draft: null, lastCheckout: { commitId: baseCommitId, timestamp: new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14) } }
  saveProjectLog(projectName, next)

  return { baseCommitId, restored, removed: changes.filter((c) => c.kind === 'added').length, trashedAs }
}
