import path from 'path'

export interface RemoveProjectsDeps {
  /** Removes the project's DAWLab history and registry entry; never touches the DAW files. */
  deleteProject: (name: string) => Promise<unknown>
  getProjectPath: (name: string) => string | null
  /** Drops the project from library folders. */
  removeFromFolders: (projectId: string | number) => void
  /** Stops watched-folder scans from suggesting this path again. */
  ignorePath: (projectPath: string) => void
  /** Stops a shared folder from bringing the project back on its next sync. */
  leaveShared?: (name: string) => Promise<unknown> | unknown
}

export interface RemoveTarget {
  id: string | number
  name: string
}

export interface RemoveProjectsResult {
  removed: string[]
  failed: { name: string; error: string }[]
}

/**
 * Takes projects out of DAWLab while leaving their files on disk: their
 * version history goes, they leave the library, and scans stop offering them.
 * One failure doesn't stop the rest.
 */
export async function removeProjectsFromLibrary(targets: RemoveTarget[], deps: RemoveProjectsDeps): Promise<RemoveProjectsResult> {
  const result: RemoveProjectsResult = { removed: [], failed: [] }
  const seen = new Set<string>()
  for (const t of targets) {
    if (!t || typeof t.name !== 'string' || !t.name || seen.has(t.name)) continue
    seen.add(t.name)
    try {
      const projectPath = deps.getProjectPath(t.name)
      await deps.deleteProject(t.name)
      deps.removeFromFolders(t.id)
      try {
        await deps.leaveShared?.(t.name)
      } catch (err) {
        console.warn(`[remove-projects] ${t.name} is out of the library, but its shared folder could not be updated:`, err)
      }
      if (projectPath && projectPath !== 'NA') deps.ignorePath(path.resolve(projectPath))
      result.removed.push(t.name)
    } catch (err) {
      result.failed.push({ name: t.name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}
