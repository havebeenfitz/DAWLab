import fs from 'fs'
import path from 'path'
import { loadLocalProjectLog } from '../core/log'
import { getCommitFileMap } from '../core/commits'
import { getCasPath } from '../core/cas'
import { getProjectStorageDirs } from '../core/storage-location'
import type { FileMapEntry } from '../types'
import { diffFileMaps, diffPlugins, type FileDiff, type PluginDiff, type DiffPlugin } from '../../../shared/version-diff'
import { AbletonParser } from '../../workers/parser'
import { LogicProParser } from '../../workers/logicProParser'

export interface VersionChanges {
  commitId: string
  /** The version this one is compared with; null for a project's first version. */
  parentId: string | null
  parentMessage: string | null
  files: FileDiff
  /** null when the DAW's project file can't be read for plugins. */
  plugins: PluginDiff | null
}

interface LogCommit { commit_id: string; timestamp: string; message: string }

/**
 * The version a commit builds on: the one before it on its branch, or for the
 * first commit of a branch, the newest earlier version on any branch.
 */
export function findParent(log: { branches?: Array<{ commits: LogCommit[] }> } | null, commitId: string): LogCommit | null {
  const branches = log?.branches ?? []
  for (const b of branches) {
    const i = b.commits.findIndex(c => c.commit_id === commitId)
    if (i > 0) return b.commits[i - 1]
    if (i === 0) {
      const self = b.commits[0]
      let best: LogCommit | null = null
      for (const other of branches) {
        for (const c of other.commits) {
          if (c.commit_id === commitId) continue
          if (c.timestamp < self.timestamp && (!best || c.timestamp > best.timestamp)) best = c
        }
      }
      return best
    }
  }
  return null
}

/** The DAW file plugins are read from, per DAW. Logic may have several alternatives. */
export function projectFilesForPlugins(fileMap: FileMapEntry[], daw: string): FileMapEntry[] {
  const files = fileMap.filter(e => e.hash !== 'empty')
  if (/logic/i.test(daw)) {
    return files.filter(e => /\.logicx\/(?:Alternatives\/[^/]+\/)?ProjectData$/.test(e.path))
  }
  if (/ableton/i.test(daw)) {
    // The top-level .als files; backups live under "Backup/".
    const als = files.filter(e => e.path.toLowerCase().endsWith('.als') && !/(^|\/)backup\//i.test(e.path))
    const top = als.filter(e => !e.path.includes('/'))
    return top.length ? top : als
  }
  return []
}

// Plugins only depend on the file's content, so cache them by its hash.
const pluginCache = new Map<string, DiffPlugin[]>()
const MAX_CACHE = 200

function pluginsOfBlob(hash: string, kind: 'logic' | 'ableton', casDir: string): DiffPlugin[] {
  const cached = pluginCache.get(`${kind}:${hash}`)
  if (cached) return cached
  const data = fs.readFileSync(getCasPath(hash, casDir))
  const meta = kind === 'logic' ? new LogicProParser().parseBuffer(data) : new AbletonParser().parseBuffer(data)
  const plugins = meta.plugins.map(p => ({ ...p }))
  if (pluginCache.size >= MAX_CACHE) pluginCache.delete(pluginCache.keys().next().value as string)
  pluginCache.set(`${kind}:${hash}`, plugins)
  return plugins
}

/**
 * Plugins used by one version. Logic alternatives are merged: a plugin counts
 * as many times as the alternative that uses it most. Ableton sets are merged
 * the same way.
 */
export function pluginsOfVersion(fileMap: FileMapEntry[], daw: string, casDir: string): DiffPlugin[] | null {
  const kind = /logic/i.test(daw) ? 'logic' : /ableton/i.test(daw) ? 'ableton' : null
  if (!kind) return null
  const sources = projectFilesForPlugins(fileMap, daw)
  if (sources.length === 0) return null
  const merged = new Map<string, DiffPlugin>()
  let readAny = false
  for (const src of sources) {
    let list: DiffPlugin[]
    try {
      list = pluginsOfBlob(src.hash, kind, casDir)
      readAny = true
    } catch (err) {
      console.warn(`[version-changes] Could not read plugins from ${path.basename(src.path)}:`, (err as Error).message)
      continue
    }
    for (const p of list) {
      const k = `${p.name.toLowerCase()}|${(p.manufacturer ?? '').toLowerCase()}`
      const prev = merged.get(k)
      if (!prev || (p.count ?? 1) > (prev.count ?? 1)) merged.set(k, { ...p })
    }
  }
  return readAny ? [...merged.values()] : null
}

/** What changed in `commitId` compared with the version before it. */
export function getVersionChanges(projectName: string, commitId: string): VersionChanges {
  const log = loadLocalProjectLog(projectName)
  if (!log) throw new Error(`Project '${projectName}' not found`)
  const { commitsDir, casDir } = getProjectStorageDirs(projectName)
  const current = getCommitFileMap(projectName, commitId, commitsDir)
  const parent = findParent(log, commitId)
  let previous: FileMapEntry[] | null = null
  if (parent) {
    try {
      previous = getCommitFileMap(projectName, parent.commit_id, commitsDir)
    } catch {
      previous = null
    }
  }

  const daw = String(log.daw ?? '')
  const currentPlugins = pluginsOfVersion(current, daw, casDir)
  const previousPlugins = previous ? pluginsOfVersion(previous, daw, casDir) : null

  return {
    commitId,
    parentId: parent?.commit_id ?? null,
    parentMessage: parent?.message ?? null,
    files: diffFileMaps(previous, current),
    // An earlier version whose plugins can't be read is treated as unchanged rather than "all new".
    plugins: currentPlugins ? diffPlugins(previous ? previousPlugins ?? currentPlugins : null, currentPlugins) : null,
  }
}
