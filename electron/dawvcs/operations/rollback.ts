import path from 'path'
import fs from 'fs'
import os from 'os'

import { loadProjectLog, saveProjectLog } from '../core/log'
import { getCommitFileMap } from '../core/commits'
import { restoreFile } from '../core/cas'
import { getProjectPath } from '../core/registry'
import { getProjectStorageDirs } from '../core/storage-location'
import { saveUnsavedWork } from './guard'

/** What a version is called in "Unsaved work before switching to …". */
function describeTarget(log: any, commitId: string): string {
  for (const b of log.branches ?? []) {
    const c = (b.commits ?? []).find((x: any) => String(x.commit_id) === String(commitId))
    if (c) return `“${String(c.message ?? '').split('\n')[0].slice(0, 60)}”${b.name !== (log.current_branch || 'main') ? ` on ${b.name}` : ''}`
  }
  return 'another version'
}

export async function rollbackProject(projectName: string, commitId: string, targetPath?: string, opts: { author?: string; target?: string } = {}) {
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
  if (ownFolder) {
    const snapshot = await saveUnsavedWork(projectName, opts.target ?? describeTarget(log, commitId), opts.author)
    if (snapshot) Object.assign(log, await loadProjectLog(projectName))
  }

  // Restore files
  if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true })
  for (const { path: rel, hash } of filemap) {
    restoreFile(hash, path.join(projectPath, rel), casDir)
  }

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  log.lastCheckout = { commitId, timestamp }
  saveProjectLog(projectName, log)

  return { success: true }
}

// Backward-compat alias
export const rollbackProjectLocal = rollbackProject
