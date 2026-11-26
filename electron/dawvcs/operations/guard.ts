/**
 * No switch may lose work. Anything that is about to overwrite or remove files
 * in a project folder first calls `saveUnsavedWork`: if the folder differs from
 * the version it was put on, DAWLab saves it as a version of its own ("Unsaved
 * work before switching to …", marked auto) and checks every file is stored.
 * Only then may the folder change; if that fails, the switch is refused.
 */
import fs from 'fs'
import { loadLocalProjectLog } from '../core/log'
import { getCommitFileMap } from '../core/commits'
import { getCasPath } from '../core/cas'
import { getProjectPath } from '../core/registry'
import { getProjectStorageDirs } from '../core/storage-location'
import { commitProject } from './commit'
import { getUnsavedChanges } from './discard'

export const AUTO_SNAPSHOT_PREFIX = 'Unsaved work before switching to'

/**
 * A project open in its DAW must not have its files replaced: the DAW keeps its
 * own copy in memory and its next save would silently put the old song back
 * over the version you switched to. The desktop app plugs in the real check
 * (is Logic running, does it hold this project's files); tests plug in their own.
 */
export type DawOpenCheck = (projectName: string) => Promise<{ app: string | null; holdsFiles: boolean }>
let dawOpenCheck: DawOpenCheck | null = null
export function setDawOpenCheck(check: DawOpenCheck | null) { dawOpenCheck = check }

export class ProjectOpenInDawError extends Error {
  readonly code = 'DAW_OPEN'
  constructor(readonly app: string, projectName: string) {
    super(`“${projectName}” is open in ${app}. Close it in ${app} first, then try again: otherwise ${app} would save its open copy over this version.`)
  }
}

/** Refuses (throws ProjectOpenInDawError) while the project is open in its DAW. */
export async function assertNotOpenInDaw(projectName: string): Promise<void> {
  if (!dawOpenCheck) return
  let state: { app: string | null; holdsFiles: boolean }
  try { state = await dawOpenCheck(projectName) } catch { return }
  if (state.app && state.holdsFiles) throw new ProjectOpenInDawError(state.app, projectName)
}

const usableFolder = (p: string | null | undefined): p is string =>
  !!p && p !== 'NA' && p !== '/' && fs.existsSync(p)

/**
 * Saves the folder as an automatic version when it has unsaved work, before
 * switching to `target` (a short description, e.g. “conflict” or alternative “drums”).
 * Returns the new version's id, or null when there was nothing to save.
 * Throws, so the caller aborts, when the snapshot can't be written completely.
 */
export async function saveUnsavedWork(projectName: string, target: string, author = ''): Promise<string | null> {
  const projectPath = getProjectPath(projectName)
  if (!usableFolder(projectPath)) return null
  const log = loadLocalProjectLog(projectName)
  if (!log) return null

  const { changes } = await getUnsavedChanges(projectName)
  if (changes.length === 0) return null
  // Only removals and nothing in the folder at all: there is nothing to keep (e.g. a fresh download).
  if (changes.every((c) => c.kind === 'deleted') && isEmptyFolder(projectPath)) return null

  const branch = log.current_branch || 'main'
  let commitId: string
  try {
    const saved = await commitProject(projectName, `${AUTO_SNAPSHOT_PREFIX} ${target}`, branch, author || 'DAWLab', { auto: true })
    commitId = saved.commitId
  } catch (err) {
    throw new Error(`Couldn't save your unsaved work first, so nothing was switched. ${(err as Error)?.message ?? ''}`.trim())
  }
  // Every file of the snapshot must be in storage before the folder may change.
  const { casDir, commitsDir } = getProjectStorageDirs(projectName)
  const missing = getCommitFileMap(projectName, commitId, commitsDir)
    .filter((e) => e.hash !== 'empty' && !fs.existsSync(getCasPath(e.hash, casDir)))
  if (missing.length) throw new Error(`Couldn't save your unsaved work first (${missing[0].path} wasn't stored), so nothing was switched.`)
  return commitId
}

function isEmptyFolder(dir: string): boolean {
  try {
    return fs.readdirSync(dir).filter((f) => f !== '.DS_Store' && f !== '.dawlabproject').length === 0
  } catch {
    return true
  }
}
