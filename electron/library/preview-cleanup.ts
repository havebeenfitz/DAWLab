/**
 * An earlier version laid parallel-version previews out next to the project,
 * where a watched-folder scan could offer them as new projects; added, they were
 * even shared. This finds such projects ("<song> (preview · name)") and takes
 * them out of DAWLab and out of the shared folder. Files on disk stay.
 */
import { isPreviewFolder } from '../dawvcs/operations/scan'

export interface PreviewCleanupDeps {
  projects: () => Array<{ id: string; name: string; path: string | null }>
  /** Names listed in this Mac's shared folders, including ones with no library entry left. */
  sharedProjects?: () => string[]
  removeFromSpace: (name: string) => Promise<unknown>
  removeFromLibrary: (targets: Array<{ id: string; name: string }>) => Promise<{ removed: string[] }>
}

export async function cleanUpPreviewProjects(deps: PreviewCleanupDeps): Promise<string[]> {
  const stray = deps.projects().filter((p) => (p.path && isPreviewFolder(p.path)) || isPreviewFolder(p.name))
  const inLibrary = new Set(stray.map((p) => p.name))
  const sharedOnly = (deps.sharedProjects?.() ?? []).filter((name) => isPreviewFolder(name) && !inLibrary.has(name))
  for (const p of [...stray, ...sharedOnly.map((name) => ({ name }))]) {
    try {
      await deps.removeFromSpace(p.name)
    } catch (err) {
      console.warn(`[preview-cleanup] Could not take ${p.name} out of its shared folder:`, err)
    }
  }
  if (!stray.length) return sharedOnly
  const { removed } = await deps.removeFromLibrary(stray.map(({ id, name }) => ({ id, name })))
  return [...removed, ...sharedOnly]
}
