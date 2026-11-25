import path from 'path'
import fs from 'fs'
import os from 'os'

import { loadProjectLog, saveProjectLog } from '../core/log'
import { getCommitFileMap } from '../core/commits'
import { restoreFile } from '../core/cas'
import { getProjectPath } from '../core/registry'
import { getProjectStorageDirs } from '../core/storage-location'
import { saveUnsavedWork } from './guard'
import { getAllFiles } from '../core/fs-utils'
import { isNoisePath } from '../core/noise'
import { trashFiles, pruneEmptyDirs, type TrashFn } from '../core/trash'

/** Electron's Trash, loaded only when needed (tests and the hub run without Electron). */
const systemTrash: TrashFn = async (full) => {
  const { shell } = await import('electron')
  await shell.trashItem(full)
}

export interface RollbackResult {
  success: true
  /** Unsaved work kept as a version before the switch, if there was any. */
  keptAs: { commitId: string; message: string } | null
  /** Files not in the version that went to the Trash, and the Trash folder holding them. */
  removed: number
  trashedAs: string | null
}

/** What a version is called in "Unsaved work before switching to …". */
function describeTarget(log: any, commitId: string): string {
  for (const b of log.branches ?? []) {
    const c = (b.commits ?? []).find((x: any) => String(x.commit_id) === String(commitId))
    if (c) return `“${String(c.message ?? '').split('\n')[0].slice(0, 60)}”${b.name !== (log.current_branch || 'main') ? ` on ${b.name}` : ''}`
  }
  return 'another version'
}

export async function rollbackProject(
  projectName: string, commitId: string, targetPath?: string,
  opts: { author?: string; target?: string; trash?: TrashFn } = {},
): Promise<RollbackResult> {
  const log = await loadProjectLog(projectName)
  if (!log) throw new Error(`Project '${projectName}' not initialized`)

  const projectPath = targetPath || getProjectPath(projectName)
  if (!projectPath || projectPath === 'NA') {
    throw new Error(`Project path not found for '${projectName}'. Please set the project path in settings.`)
  }

  // Safety: block dangerous paths
  const homeDir = os.homedir()
  const tmpDir = os.tmpdir()
  const isInTempDir = projectPath.startsWith(tmpDir) || projectPath.startsWith('/tmp/')
  const isDangerousPath = (
    projectPath === '/' ||
    projectPath === homeDir ||
    projectPath === path.dirname(homeDir) ||
    projectPath.startsWith('/etc') ||
    projectPath.startsWith('/usr') ||
    projectPath.startsWith('/bin') ||
    projectPath.startsWith('/sbin') ||
    projectPath.startsWith('/System') ||
    projectPath.startsWith('/Library')
  )
  const isCriticalPath = (
    projectPath === '/' ||
    projectPath === homeDir ||
    projectPath === path.dirname(homeDir)
  )
  if ((isCriticalPath || (isDangerousPath && !isInTempDir)) && !targetPath) {
    throw new Error(`CRITICAL SECURITY: Cannot rollback to dangerous path: ${projectPath}`)
  }

  const { casDir, commitsDir } = getProjectStorageDirs(projectName)
  const filemap = getCommitFileMap(projectName, commitId, commitsDir)

  // Writing into the project folder itself: keep unsaved work first, or don't switch at all.
  const ownFolder = !targetPath || path.resolve(targetPath) === path.resolve(getProjectPath(projectName) || '')
  let keptAs: RollbackResult['keptAs'] = null
  let removed = 0
  let trashedAs: string | null = null
  if (ownFolder) {
    const message = opts.target ?? describeTarget(log, commitId)
    const snapshot = await saveUnsavedWork(projectName, message, opts.author)
    if (snapshot) {
      Object.assign(log, await loadProjectLog(projectName))
      keptAs = { commitId: snapshot, message: `Unsaved work before switching to ${message}` }
    }
    // An exact copy of the version: files it doesn't have go to the Trash (they're kept in a version too).
    if (fs.existsSync(projectPath)) {
      const inTarget = new Set(filemap.filter((e) => e.hash !== 'empty').map((e) => e.path))
      const extra = Object.entries(await getAllFiles(projectPath, log.ignoredFiles || []))
        .filter(([rel, full]) => full !== 'empty' && !isNoisePath(rel) && !inTarget.has(rel))
        .map(([rel]) => rel)
      trashedAs = await trashFiles(projectPath, extra, 'removed by restore', opts.trash ?? systemTrash)
      removed = extra.length
      pruneEmptyDirs(projectPath, extra)
    }
  }

  // Restore files
  if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true })
  for (const { path: rel, hash } of filemap) {
    restoreFile(hash, path.join(projectPath, rel), casDir)
  }

  // Only the project folder itself is "checked out"; laying a version out elsewhere (a preview) isn't.
  if (ownFolder) {
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
    log.lastCheckout = { commitId, timestamp }
    saveProjectLog(projectName, log)
  }

  return { success: true, keptAs, removed, trashedAs }
}

// Backward-compat alias
export const rollbackProjectLocal = rollbackProject
