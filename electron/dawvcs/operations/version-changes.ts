import fs from 'fs'
import path from 'path'
import { loadLocalProjectLog } from '../core/log'
import { getCommitFileMap } from '../core/commits'
import { getCasPath } from '../core/cas'
import { getProjectStorageDirs } from '../core/storage-location'
import type { FileMapEntry } from '../types'
import { diffFileMaps, diffPlugins, type FileChange, type FileDiff, type PluginDiff, type DiffPlugin } from '../../../shared/version-diff'
import { AbletonParser } from '../../workers/parser'
import { LogicProParser } from '../../workers/logicProParser'
import { diffSong, type SongDiff, type SongInfo } from '../../../shared/song-diff'
import { songInfoOfVersion } from './song-info'
import { isLayoutPath } from '../../../shared/noise'
import { AUDIO_EXT, sampleHashOfBlob, sampleCacheFile } from '../core/audio-samples'
import { logicChangesBetween, workingLogicChanges } from './logic-changes'
import { getWorkingChanges } from './discard'
import { getProjectPath } from '../core/registry'
import { summarizeChanges, type LogicChange } from '../../../shared/logic-project'

export interface VersionChanges {
  commitId: string
  /** The version this one is compared with; null for a project's first version. */
  parentId: string | null
  parentMessage: string | null
  files: FileDiff
  /** null when the DAW's project file can't be read for plugins. */
  plugins: PluginDiff | null
  /** Tempo, tracks, key… of this version; null when unreadable. */
  song: SongInfo | null
  /** What changed in the song since the previous version; null without a readable song. */
  songChanges: SongDiff | null
  /** What changed inside the Logic project (markers, mixer, regions…); null when it isn't a Logic project. */
  logic: LogicChange[] | null
}

interface LogCommit { commit_id: string; timestamp: string; message: string; parent?: string }

/**
 * The version a commit builds on: the one before it on its branch, or for the
 * first commit of a branch, the newest earlier version on any branch.
 */
export function findParent(log: { branches?: Array<{ commits: LogCommit[] }> } | null, commitId: string): LogCommit | null {
  const branches = log?.branches ?? []
  // Versions that recorded what they were saved on top of (also across alternatives).
  const self = branches.flatMap(b => b.commits).find(c => c.commit_id === commitId)
  if (self?.parent) {
    const recorded = branches.flatMap(b => b.commits).find(c => c.commit_id === self.parent)
    if (recorded) return recorded
  }
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

function pluginsOfBlob(entry: FileMapEntry, kind: 'logic' | 'ableton', read: (e: FileMapEntry) => Buffer): DiffPlugin[] {
  const hash = entry.hash
  const cached = pluginCache.get(`${kind}:${hash}`)
  if (cached) return cached
  const data = read(entry)
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
export function pluginsOfVersion(
  fileMap: FileMapEntry[], daw: string, casDir: string, alternative?: string | null,
  read: (e: FileMapEntry) => Buffer = (e) => fs.readFileSync(getCasPath(e.hash, casDir)),
): DiffPlugin[] | null {
  const kind = /logic/i.test(daw) ? 'logic' : /ableton/i.test(daw) ? 'ableton' : null
  if (!kind) return null
  const all = projectFilesForPlugins(fileMap, daw)
  // A Logic project opens one alternative: count only its plugins when we know which one.
  const picked = alternative ? all.filter((e) => alternativeOf(e.path) === alternative) : []
  const sources = picked.length ? picked : all
  if (sources.length === 0) return null
  const merged = new Map<string, DiffPlugin>()
  let readAny = false
  for (const src of sources) {
    let list: DiffPlugin[]
    try {
      list = pluginsOfBlob(src, kind, read)
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

const alternativeOf = (p: string) => p.match(/\.logicx\/(Alternatives\/[^/]+)\/ProjectData$/)?.[1] ?? ''

/**
 * The Logic alternative a version was worked on: the one whose ProjectData
 * changed since `previous`, else the newest-numbered one. Null for one alternative.
 */
export function workedOnAlternative(current: FileMapEntry[], previous: FileMapEntry[] | null): string | null {
  const datas = current.filter((e) => e.hash !== 'empty' && /\.logicx\/Alternatives\/[^/]+\/ProjectData$/.test(e.path))
  if (datas.length < 2) return null
  const before = new Map((previous ?? []).map((e) => [e.path, e.hash]))
  const changed = datas.filter((e) => before.get(e.path) !== e.hash)
  const pool = changed.length ? changed : datas
  return alternativeOf([...pool].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })).pop()!.path)
}

/** What changed in `commitId` compared with the version before it. */
/** What changed in `commitId` compared with the version before it, or with `baseId` when given. */
export async function getVersionChanges(projectName: string, commitId: string, baseId?: string): Promise<VersionChanges> {
  const log = loadLocalProjectLog(projectName)
  if (!log) throw new Error(`Project '${projectName}' not found`)
  const { commitsDir, casDir } = getProjectStorageDirs(projectName)
  const current = getCommitFileMap(projectName, commitId, commitsDir)
  const parent = baseId
    ? (log.branches ?? []).flatMap((b: any) => b.commits).find((c: any) => String(c.commit_id) === baseId) ?? null
    : findParent(log, commitId)
  let previous: FileMapEntry[] | null = null
  if (parent) {
    try {
      previous = getCommitFileMap(projectName, parent.commit_id, commitsDir)
    } catch {
      previous = null
    }
  }

  const daw = String(log.daw ?? '')
  const alternative = /logic/i.test(daw) ? workedOnAlternative(current, previous) : null
  const currentPlugins = pluginsOfVersion(current, daw, casDir, alternative)
  const previousPlugins = previous ? pluginsOfVersion(previous, daw, casDir, alternative) : null

  const song = songInfoOfVersion(current, daw, casDir, previous)
  const previousSong = previous ? songInfoOfVersion(previous, daw, casDir) : null

  return {
    commitId,
    song,
    songChanges: song ? diffSong(previousSong, song) : null,
    parentId: parent?.commit_id ?? null,
    parentMessage: parent?.message ?? null,
    files: await withQuietChanges(diffFileMaps(previous, current), previous, current, casDir),
    logic: /logic/i.test(daw)
      ? logicChangesBetween(previous ? { kind: 'version', map: previous, casDir } : null, { kind: 'version', map: current, casDir })
      : null,
    // An earlier version whose plugins can't be read is treated as unchanged rather than "all new".
    plugins: currentPlugins ? diffPlugins(previous ? previousPlugins ?? currentPlugins : null, currentPlugins) : null,
  }
}

/**
 * Moves what isn't a change to the song out of the list: Logic's window layout,
 * and audio files whose sound is identical (only the header was rewritten).
 */
export async function withQuietChanges(diff: FileDiff, previous: FileMapEntry[] | null, current: FileMapEntry[], casDir: string): Promise<FileDiff> {
  const before = new Map((previous ?? []).map((e) => [e.path, e.hash]))
  const after = new Map(current.map((e) => [e.path, e.hash]))
  const keep: FileDiff['changes'] = []
  const quiet: FileDiff['changes'] = []
  for (const c of diff.changes) {
    if (isLayoutPath(c.path)) { quiet.push(c); continue }
    if (c.kind === 'modified' && AUDIO_EXT.test(c.path)) {
      const a = before.get(c.path), b = after.get(c.path)
      const cache = sampleCacheFile(casDir)
      const sa = a ? await sampleHashOfBlob(a, getCasPath(a, casDir), c.path, cache) : null
      const sb = b ? await sampleHashOfBlob(b, getCasPath(b, casDir), c.path, cache) : null
      if (sa && sa === sb) { quiet.push(c); continue }
    }
    keep.push(c)
  }
  const count = (k: string) => keep.filter((c) => c.kind === k).length
  return {
    ...diff, changes: keep, quiet,
    added: count('added'), removed: count('removed'), modified: count('modified'), renamed: count('renamed'),
    unchanged: diff.unchanged + quiet.length,
  }
}

/**
 * One line on what changed in a Logic project's version, for a notification.
 * Null when the version (or its parent) isn't on this Mac yet, it isn't a
 * Logic project, or nothing readable changed.
 */
export function logicSummaryOfVersion(projectName: string, commitId: string): string | null {
  try {
    const log = loadLocalProjectLog(projectName)
    if (!log || !/logic/i.test(String(log.daw ?? ''))) return null
    const { commitsDir, casDir } = getProjectStorageDirs(projectName)
    const current = getCommitFileMap(projectName, commitId, commitsDir)
    const parent = findParent(log, commitId)
    if (!parent) return null
    const previous = getCommitFileMap(projectName, parent.commit_id, commitsDir)
    const lines = logicChangesBetween({ kind: 'version', map: previous, casDir }, { kind: 'version', map: current, casDir })
    // A loss leads, so it is never cut off.
    const sorted = (lines ?? []).filter((l) => l.kind !== 'other').sort((a, b) => Number(!!b.loss) - Number(!!a.loss))
    return summarizeChanges(sorted, 2) || null
  } catch {
    return null
  }
}

/** The id the renderer uses for "the unsaved changes in the folder" in place of a version id. */
export const UNSAVED_ID = 'unsaved'

/**
 * The unsaved changes in the project folder, compared with the version the
 * folder was last saved as (or restored to): files, song, plugins and, for
 * Logic, what changed inside the project. Null when there is nothing saved yet.
 */
export async function getUnsavedVersionChanges(projectName: string): Promise<VersionChanges | null> {
  const working = await getWorkingChanges(projectName)
  const baseId = working.baseCommitId
  if (!baseId) return null
  const log = loadLocalProjectLog(projectName)
  const root = getProjectPath(projectName)
  if (!log || !root || root === 'NA') return null
  const { commitsDir, casDir } = getProjectStorageDirs(projectName)
  const base = getCommitFileMap(projectName, baseId, commitsDir)
  const parent = (log.branches ?? []).flatMap((b: any) => b.commits ?? []).find((c: any) => String(c.commit_id) === baseId) ?? null
  const daw = String(log.daw ?? '')

  // The folder as a file map: the saved version with the changed files swapped for what is on disk.
  const changedPaths = new Map([...working.changes, ...working.quiet].map((c) => [c.path, c]))
  const onDisk = (p: string): FileMapEntry | null => {
    try {
      const st = fs.statSync(path.join(root, p))
      return { path: p, hash: `folder:${p}:${st.size}:${st.mtimeMs}` } as FileMapEntry
    } catch { return null }
  }
  const folder: FileMapEntry[] = []
  for (const e of base) {
    const c = changedPaths.get(e.path)
    if (!c) folder.push(e)
    else if (c.kind !== 'deleted') { const d = onDisk(e.path); if (d) folder.push(d) }
  }
  for (const c of changedPaths.values()) if (c.kind === 'added') { const d = onDisk(c.path); if (d) folder.push(d) }
  const read = (e: FileMapEntry) => (e.hash.startsWith('folder:') ? fs.readFileSync(path.join(root, e.path)) : fs.readFileSync(getCasPath(e.hash, casDir)))

  const asChange = (c: { kind: string; path: string }): FileChange => ({ kind: c.kind === 'deleted' ? 'removed' : (c.kind as 'added' | 'modified'), path: c.path })
  const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path)
  const changes = working.changes.map(asChange).sort(byPath)
  const count = (k: string) => changes.filter((c) => c.kind === k).length
  const files: FileDiff = {
    changes,
    added: count('added'),
    removed: count('removed'),
    modified: count('modified'),
    renamed: 0,
    unchanged: base.filter((e) => e.hash !== 'empty').length - count('modified') - count('removed'),
    quiet: working.quiet.map(asChange).sort(byPath),
  }

  const isLogic = /logic/i.test(daw)
  const alternative = isLogic ? workedOnAlternative(folder, base) : null
  const before = pluginsOfVersion(base, daw, casDir, alternative)
  const now = pluginsOfVersion(folder, daw, casDir, alternative, read)
  const song = songInfoOfVersion(folder, daw, casDir, base, read)
  const previousSong = songInfoOfVersion(base, daw, casDir)
  return {
    commitId: UNSAVED_ID,
    parentId: baseId,
    parentMessage: parent?.message ?? null,
    files,
    plugins: now ? diffPlugins(before ?? now, now) : null,
    song,
    songChanges: song ? diffSong(previousSong, song) : null,
    logic: isLogic ? workingLogicChanges(projectName, baseId) : null,
  }
}
