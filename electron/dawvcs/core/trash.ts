/**
 * Moving files out of a project into the macOS Trash, all at once: they go into
 * one folder named after the project and what happened, so they're easy to find
 * there. If the Trash step fails, every file is put back where it was.
 */
import fs from 'fs'
import path from 'path'

/** Moves a path to the Trash. Electron's shell.trashItem in the app; injectable for tests. */
export type TrashFn = (fullPath: string) => Promise<void>

const stamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

/**
 * Moves `rels` (project-relative, `/`-separated) out of `projectPath` into the
 * Trash, in a folder "<project> — <what> <date>". Returns that folder's name,
 * or null when there was nothing to move. Throws, with nothing moved, on failure.
 */
export async function trashFiles(projectPath: string, rels: string[], what: string, trash: TrashFn): Promise<string | null> {
  if (rels.length === 0) return null
  const name = `${path.basename(projectPath)} — ${what} ${stamp()}`
  const staging = path.join(path.dirname(projectPath), name)
  if (fs.existsSync(staging)) throw new Error('Try again in a second.')
  const moved: string[] = []
  const putBack = () => {
    for (const rel of moved) {
      try {
        fs.mkdirSync(path.dirname(path.join(projectPath, rel)), { recursive: true })
        fs.renameSync(path.join(staging, rel), path.join(projectPath, rel))
      } catch { /* best effort */ }
    }
    fs.rmSync(staging, { recursive: true, force: true })
  }
  try {
    for (const rel of rels) {
      const to = path.join(staging, rel)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.renameSync(path.join(projectPath, rel), to)
      moved.push(rel)
    }
    await trash(staging)
  } catch (err) {
    putBack()
    throw new Error(`Couldn't move files to the Trash, so nothing was changed. ${(err as Error)?.message ?? ''}`.trim())
  }
  return name
}

/** Removes folders left empty under `root` by removed files, deepest first; never `root` itself. */
export function pruneEmptyDirs(root: string, rels: string[]) {
  const dirs = new Set<string>()
  for (const rel of rels) for (let d = path.posix.dirname(rel); d !== '.'; d = path.posix.dirname(d)) dirs.add(d)
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    const full = path.join(root, d)
    try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full) } catch { /* gone or not empty */ }
  }
}
