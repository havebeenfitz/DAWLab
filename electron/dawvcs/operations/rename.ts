/**
 * Renaming a project: its name in DAWLab, and optionally its folder on disk
 * with the DAW file named after it. Every place that stores the project by
 * name follows: the registry, the log file, the versions folder.
 *
 * Also finds projects whose folder was renamed or moved outside DAWLab, so a
 * sync never lays a project out again into the folder it no longer has.
 */
import fs from 'fs'
import path from 'path'
import { loadRegistry, saveRegistry } from '../core/registry'
import { loadLocalProjectLog, saveProjectLog, deleteProjectLog } from '../core/log'
import { resolveStorageDirs, getProjectStorageDirs, type StorageMode } from '../core/storage-location'
import { getCommitFileMap } from '../core/commits'

/** Project files of the DAWs DAWLab knows, named after the project. */
const DAW_EXTENSIONS = ['.logicx', '.als', '.flp', '.ptx', '.cpr', '.rpp', '.song', '.bwproject', '.reason']

/** A name that works as a folder name on macOS and Windows; throws with a reason otherwise. */
export function checkProjectName(raw: unknown): string {
  const name = String(raw ?? '').trim()
  if (!name) throw new Error('Type a name for the project.')
  if (name.length > 120) throw new Error('That name is too long.')
  if (/[\\/:*?"<>|\p{Cc}]/u.test(name)) throw new Error('A project name can’t contain / \\ : * ? " < > |')
  if (name.startsWith('.')) throw new Error('A project name can’t start with a dot.')
  return name
}

export interface RenameResult {
  name: string
  path: string
  /** The folder on disk was renamed too. */
  folderRenamed: boolean
}

/**
 * Renames a project. With `renameFolder`, the folder (when it is named after
 * the project) and the DAW file inside it named the same way are renamed too.
 * Nothing changes when a step can't be done safely.
 */
export function renameProject(oldName: string, rawNewName: string, opts: { renameFolder: boolean }): RenameResult {
  const newName = checkProjectName(rawNewName)
  const registry = loadRegistry()
  const entry = registry[oldName]
  if (!entry) throw new Error(`Project '${oldName}' not found`)
  const oldPath: string = entry.path
  const hasFolder = !!oldPath && oldPath !== 'NA' && oldPath !== '/' && fs.existsSync(oldPath)
  if (newName === oldName && (!opts.renameFolder || !hasFolder || path.basename(oldPath) === newName)) {
    return { name: oldName, path: oldPath, folderRenamed: false }
  }
  if (newName !== oldName && registry[newName]) throw new Error(`There is already a project named “${newName}”.`)

  const log = loadLocalProjectLog(oldName)
  if (!log) throw new Error(`Project '${oldName}' has no history on this Mac.`)

  // 1. The folder, when it carries the project's name (a folder named otherwise stays as it is).
  let newPath = oldPath
  let folderRenamed = false
  const oldFolderName = hasFolder ? path.basename(oldPath) : ''
  if (opts.renameFolder && hasFolder && oldFolderName === oldName) {
    const target = path.join(path.dirname(oldPath), newName)
    if (target !== oldPath) {
      if (fs.existsSync(target) && !sameFile(target, oldPath)) {
        throw new Error(`There is already a folder named “${newName}” next to this project.`)
      }
      fs.renameSync(oldPath, target)
      newPath = target
      folderRenamed = true
    }
  }

  try {
    // 2. The DAW file named after the project or its old folder.
    let primaryFile = log.primaryFile ?? null
    if (folderRenamed) {
      for (const entryName of fs.readdirSync(newPath)) {
        const ext = path.extname(entryName)
        const base = entryName.slice(0, entryName.length - ext.length)
        if (!DAW_EXTENSIONS.includes(ext.toLowerCase())) continue
        if (base !== oldName && base !== oldFolderName) continue
        const renamed = newName + ext
        if (fs.existsSync(path.join(newPath, renamed))) continue
        fs.renameSync(path.join(newPath, entryName), path.join(newPath, renamed))
        if (primaryFile === entryName) primaryFile = renamed
      }
    }

    // 3. The versions folder (it moved with the project folder when versions live next to it).
    const mode: StorageMode = entry.storage_mode === 'project' ? 'project' : 'home'
    const { commitsDir } = resolveStorageDirs(mode, newPath)
    const fromDir = path.join(commitsDir, oldName)
    const toDir = path.join(commitsDir, newName)
    if (oldName !== newName && fs.existsSync(fromDir)) {
      if (fs.existsSync(toDir)) throw new Error(`Versions for “${newName}” already exist on this Mac.`)
      fs.renameSync(fromDir, toDir)
    }

    // 4. The log, then the registry.
    if (oldName !== newName) {
      saveProjectLog(newName, { ...log, name: newName, primaryFile })
      deleteProjectLog(oldName, log.id)
    } else if (primaryFile !== (log.primaryFile ?? null)) {
      saveProjectLog(oldName, { ...log, primaryFile })
    }
    const next = { ...loadRegistry() }
    delete next[oldName]
    next[newName] = { ...entry, name: newName, path: newPath }
    saveRegistry(next)
  } catch (err) {
    if (folderRenamed) {
      try { fs.renameSync(newPath, oldPath) } catch { /* leave it where it is */ }
    }
    throw err
  }
  return { name: newName, path: newPath, folderRenamed }
}

function sameFile(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(a), sb = fs.statSync(b)
    return sa.ino === sb.ino && sa.dev === sb.dev // a case-only rename on a case-insensitive disk
  } catch {
    return false
  }
}

/**
 * Projects whose folder is gone from where DAWLab expects it, found again in
 * the same parent folder: by their own versions folder (`.dawlabproject`), or
 * by the files of their newest version.
 * Returns each one's new folder; nothing is changed.
 */
export function findMovedProjects(names?: string[]): Array<{ name: string; from: string; to: string }> {
  const registry = loadRegistry()
  const taken = new Set(Object.values<any>(registry).map((p) => p?.path).filter(Boolean))
  const found: Array<{ name: string; from: string; to: string }> = []
  for (const [name, entry] of Object.entries<any>(registry)) {
    if (names && !names.includes(name)) continue
    const from: string = entry?.path
    if (!from || from === 'NA' || from === '/' || fs.existsSync(from)) continue
    const parent = path.dirname(from)
    let siblings: string[]
    try { siblings = fs.readdirSync(parent) } catch { continue }
    const candidates = siblings.map((s) => path.join(parent, s)).filter((dir) => !taken.has(dir) && isDir(dir))
    // Versions kept next to the project travel with the folder; otherwise the files of its newest version tell.
    const files = entry.storage_mode === 'project' ? null : latestFiles(name)
    const matches = candidates.filter((dir) => (files
      ? looksLike(dir, files)
      : fs.existsSync(path.join(dir, '.dawlabproject', 'commits', name))))
    // Only a single, unambiguous match: two copies are the user's call.
    if (matches.length === 1) {
      found.push({ name, from, to: matches[0] })
      taken.add(matches[0])
    }
  }
  return found
}

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory() } catch { return false } }

/** Paths of the project's newest version (the one last laid out, else the newest saved). */
function latestFiles(name: string): string[] | null {
  const log = loadLocalProjectLog(name)
  const commits = (log?.branches ?? []).flatMap((b: any) => b.commits ?? [])
  if (!commits.length) return null
  const byTime = (a: any, b: any) => String(a.timestamp).localeCompare(String(b.timestamp))
  const id = String(log.lastCheckout?.commitId ?? [...commits].sort(byTime).pop().commit_id)
  try {
    const { commitsDir } = getProjectStorageDirs(name)
    return getCommitFileMap(name, id, commitsDir).map((f) => f.path)
  } catch {
    return null
  }
}

/**
 * Most of the version's files are in `dir`. A DAW file or package at the top
 * may carry a new name (renamed with the folder), so it matches by extension.
 */
function looksLike(dir: string, files: string[]): boolean {
  const top = (() => { try { return fs.readdirSync(dir) } catch { return [] } })()
  const exists = (rel: string) => {
    const [first, ...rest] = rel.split('/')
    const ext = path.extname(first).toLowerCase()
    if (!DAW_EXTENSIONS.includes(ext)) return fs.existsSync(path.join(dir, rel))
    return top.some((t) => path.extname(t).toLowerCase() === ext && fs.existsSync(path.join(dir, t, ...rest)))
  }
  const sample = files.slice(0, 400)
  const hits = sample.filter(exists).length
  return sample.length > 0 && hits / sample.length >= 0.8
}

/** Points a project at its new folder. */
export function relinkProject(name: string, to: string) {
  const registry = loadRegistry()
  if (!registry[name]) return
  saveRegistry({ ...registry, [name]: { ...registry[name], path: to } })
}
