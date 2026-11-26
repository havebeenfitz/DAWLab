import fs from 'fs'
import path from 'path'
import { COMMITS_DIR, LOGS_DIR, getCommitsDir, getLogsDir, listUsers, getRegistryFile } from '../core/constants'
import { getCasPath, CAS_DIR } from '../core/cas'
import { resolveStorageDirs } from '../core/storage-location'
import { FileMapEntry } from '../types'

export interface CleanableFile {
  hash: string
  /** Bytes freed by cleaning it (summed when the same file is left over in several stores). */
  size: number
  filename: string // Just one filename for display (e.g. "drums.wav")
  projectNames: string[] // List of projects using this file
}

export interface CleanStats {
  filesDeleted: number
  bytesFreed: number
  errors: string[]
}

interface Store {
  casDir: string
  commitsDir: string
}

const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const subdirs = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * Every place versions are kept, for every user on this Mac: the shared home
 * store (with each user's commits and the legacy commits folder) and each
 * project that keeps its versions next to itself in `.dawlabproject`.
 */
function allStores(): Store[] {
  const stores = new Map<string, Store>()
  const add = (casDir: string, commitsDir: string) => {
    const key = `${casDir}\0${commitsDir}`
    if (!stores.has(key)) stores.set(key, { casDir, commitsDir })
  }
  add(CAS_DIR, COMMITS_DIR)
  for (const user of listUsers()) {
    add(CAS_DIR, getCommitsDir(user))
    const projects = readJson(getRegistryFile(user))?.projects ?? {}
    for (const info of Object.values(projects) as Array<{ storage_mode?: string; path?: string }>) {
      if (info?.storage_mode === 'project' && info.path) {
        const dirs = resolveStorageDirs('project', info.path)
        add(dirs.casDir, dirs.commitsDir)
      }
    }
  }
  return [...stores.values()]
}

/** Hashes some version still needs (files and previews), with a name and the projects using each. */
function hashesInUse(stores: Store[]) {
  const usage = new Map<string, { filename: string; projects: Set<string> }>()
  const record = (hash: string | undefined, filename: string, project: string) => {
    if (!hash || hash === 'empty') return
    const known = usage.get(hash)
    if (known) known.projects.add(project)
    else usage.set(hash, { filename, projects: new Set([project]) })
  }

  for (const commitsDir of new Set(stores.map((s) => s.commitsDir))) {
    for (const project of subdirs(commitsDir)) {
      for (const commitId of subdirs(path.join(commitsDir, project))) {
        const filemap = readJson(path.join(commitsDir, project, commitId, 'filemap.json'))
        if (!Array.isArray(filemap)) continue
        for (const entry of filemap as FileMapEntry[]) record(entry.hash, path.basename(entry.path), project)
      }
    }
  }

  // Previews are kept in the stores too; the project log is what points at them.
  const logDirs = [LOGS_DIR, ...listUsers().map((u) => getLogsDir(u))]
  for (const dir of logDirs) {
    let files: string[]
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { continue }
    for (const file of files) {
      const log = readJson(path.join(dir, file))
      const project = String(log?.project_name ?? log?.name ?? file.replace(/\.json$/, ''))
      for (const branch of log?.branches ?? []) {
        for (const commit of branch?.commits ?? []) record(commit?.preview_file, 'Preview', project)
      }
    }
  }
  return usage
}

/** Stored files of one store: hash → bytes. */
function storedFiles(casDir: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of subdirs(casDir)) {
    for (const b of subdirs(path.join(casDir, a))) {
      let hashes: string[]
      try { hashes = fs.readdirSync(path.join(casDir, a, b)) } catch { continue }
      for (const hash of hashes) {
        try { out.set(hash, fs.statSync(getCasPath(hash, casDir)).size) } catch { /* skip unreadable */ }
      }
    }
  }
  return out
}

/** Every stored file no version needs any more, in every store, as [casDir, hash, bytes]. */
function leftovers(): Array<{ casDir: string; hash: string; size: number }> {
  const stores = allStores()
  const inUse = hashesInUse(stores)
  const out: Array<{ casDir: string; hash: string; size: number }> = []
  for (const casDir of new Set(stores.map((s) => s.casDir))) {
    for (const [hash, size] of storedFiles(casDir)) if (!inUse.has(hash)) out.push({ casDir, hash, size })
  }
  return out
}

/**
 * Files in DAWLab's stores that no version of any project on this Mac needs:
 * leftovers of deleted projects and versions, and replaced previews.
 * Covers the home store and each project's own `.dawlabproject` store.
 */
export function getCleanableFiles(): CleanableFile[] {
  const byHash = new Map<string, CleanableFile>()
  for (const { hash, size } of leftovers()) {
    const known = byHash.get(hash)
    if (known) known.size += size
    else byHash.set(hash, { hash, size, filename: hash, projectNames: [] })
  }
  return [...byHash.values()]
}

/** Deletes the given leftovers. A hash some version still needs is never deleted. */
export function cleanCasFiles(hashes: string[]): CleanStats {
  const stats: CleanStats = { filesDeleted: 0, bytesFreed: 0, errors: [] }
  const wanted = new Set(hashes)
  for (const { casDir, hash, size } of leftovers()) {
    if (!wanted.has(hash)) continue
    const casPath = getCasPath(hash, casDir)
    try {
      fs.unlinkSync(casPath)
      stats.filesDeleted++
      stats.bytesFreed += size
      removeEmptyParents(casPath, casDir)
    } catch (err: any) {
      stats.errors.push(`Failed to delete ${hash}: ${err.message}`)
    }
  }
  return stats
}

function removeEmptyParents(casPath: string, casDir: string) {
  try {
    for (let dir = path.dirname(casPath); dir.startsWith(casDir + path.sep); dir = path.dirname(dir)) {
      if (fs.readdirSync(dir).length) break
      fs.rmdirSync(dir)
    }
  } catch { /* leave it */ }
}
