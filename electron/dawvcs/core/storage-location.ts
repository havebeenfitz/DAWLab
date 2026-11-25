import path from 'path'
import { CAS_DIR, getCommitsDir } from './constants'
import { loadRegistry } from './registry'

export type StorageMode = 'home' | 'project'

/**
 * Pure — no registry lookup. Used by init.ts where mode/path are already known
 * up front (before the registry entry exists yet).
 */
export function resolveStorageDirs(mode: StorageMode, projectPath?: string): { casDir: string; commitsDir: string } {
  if (mode === 'project' && projectPath && projectPath !== 'NA') {
    const root = path.join(projectPath, '.dawlabproject')
    return { casDir: path.join(root, 'cas'), commitsDir: path.join(root, 'commits') }
  }
  return { casDir: CAS_DIR, commitsDir: getCommitsDir() }
}

/** Looks up the project's mode + path from the registry and resolves its storage dirs. */
export function getProjectStorageDirs(projectName: string): { casDir: string; commitsDir: string; mode: StorageMode } {
  const info = loadRegistry()[projectName]
  const mode: StorageMode = info?.storage_mode === 'project' ? 'project' : 'home'
  return { ...resolveStorageDirs(mode, info?.path), mode }
}

/**
 * Every folder versions are stored in: the shared one in the home folder and
 * each project's own `.dawlabproject/cas` when it keeps versions next to itself.
 */
export function allCasDirs(): string[] {
  const dirs = new Set<string>([CAS_DIR])
  for (const info of Object.values(loadRegistry()) as Array<{ storage_mode?: string; path?: string }>) {
    if (info?.storage_mode === 'project') dirs.add(resolveStorageDirs('project', info.path).casDir)
  }
  return [...dirs]
}
