/**
 * What changed between two versions of a project, the way `git diff --stat`
 * would put it: files added, removed, changed and moved, and plugins added,
 * removed or used a different number of times. Pure, so the app and tests share it.
 */

export interface DiffFileEntry {
  path: string
  hash: string
}

export type FileChangeKind = 'added' | 'removed' | 'modified' | 'renamed'

export interface FileChange {
  kind: FileChangeKind
  path: string
  /** For `renamed`: where the file was before. */
  from?: string
}

export interface FileDiff {
  /** Sorted by path; folders keep their files together. */
  changes: FileChange[]
  added: number
  removed: number
  modified: number
  renamed: number
  unchanged: number
}

/** DAWLab's own storage folder inside a project is never part of a version. */
const isInternal = (p: string) => p === '.dawlabproject' || p.startsWith('.dawlabproject/')
/** Folder placeholders in a filemap carry the hash "empty"; they aren't files. */
const isFile = (e: DiffFileEntry) => e.hash !== 'empty'

export function diffFileMaps(previous: DiffFileEntry[] | null, current: DiffFileEntry[]): FileDiff {
  const prev = new Map<string, string>()
  for (const e of previous ?? []) if (isFile(e) && !isInternal(e.path)) prev.set(e.path, e.hash)
  const curr = new Map<string, string>()
  for (const e of current) if (isFile(e) && !isInternal(e.path)) curr.set(e.path, e.hash)

  const changes: FileChange[] = []
  let unchanged = 0
  const addedPaths: string[] = []
  for (const [p, h] of curr) {
    const before = prev.get(p)
    if (before === undefined) addedPaths.push(p)
    else if (before !== h) changes.push({ kind: 'modified', path: p })
    else unchanged++
  }
  const removedPaths = [...prev.keys()].filter(p => !curr.has(p))

  // A removed and an added file with the same content is a move or rename.
  const removedByHash = new Map<string, string[]>()
  for (const p of removedPaths) {
    const h = prev.get(p)!
    removedByHash.set(h, [...(removedByHash.get(h) ?? []), p])
  }
  const movedFrom = new Set<string>()
  for (const p of addedPaths) {
    const candidates = removedByHash.get(curr.get(p)!)
    const from = candidates?.shift()
    if (from) {
      movedFrom.add(from)
      changes.push({ kind: 'renamed', path: p, from })
    } else {
      changes.push({ kind: 'added', path: p })
    }
  }
  for (const p of removedPaths) if (!movedFrom.has(p)) changes.push({ kind: 'removed', path: p })

  changes.sort((a, b) => a.path.localeCompare(b.path))
  const count = (k: FileChangeKind) => changes.filter(c => c.kind === k).length
  return {
    changes,
    added: count('added'),
    removed: count('removed'),
    modified: count('modified'),
    renamed: count('renamed'),
    unchanged,
  }
}

export interface DiffPlugin {
  name: string
  manufacturer?: string
  type?: string
  is_instrument?: boolean
  /** How many times the plugin is used in the project; 1 when unknown. */
  count?: number
}

export type PluginChangeKind = 'added' | 'removed' | 'count' | 'same'

export interface PluginChange {
  kind: PluginChangeKind
  plugin: DiffPlugin
  /** Uses before and after; for `added` before is 0, for `removed` after is 0. */
  before: number
  after: number
}

export interface PluginDiff {
  /** Added and removed first, then count changes, then the unchanged rest; each group by name. */
  changes: PluginChange[]
  added: number
  removed: number
  countChanged: number
}

const vendor = (m?: string) => (!m || m === 'Unknown' ? '' : m)
const pluginKey = (p: DiffPlugin) => `${p.name.trim().toLowerCase()}|${vendor(p.manufacturer).trim().toLowerCase()}`

function tally(list: DiffPlugin[]): Map<string, { plugin: DiffPlugin; count: number }> {
  const out = new Map<string, { plugin: DiffPlugin; count: number }>()
  for (const p of list) {
    if (!p || !p.name) continue
    const k = pluginKey(p)
    const n = p.count && p.count > 0 ? p.count : 1
    const seen = out.get(k)
    if (seen) seen.count += n
    else out.set(k, { plugin: p, count: n })
  }
  return out
}

/** `previous` null means there is no earlier version: everything is new. */
export function diffPlugins(previous: DiffPlugin[] | null, current: DiffPlugin[]): PluginDiff {
  const before = tally(previous ?? [])
  const after = tally(current)
  const changes: PluginChange[] = []
  for (const [k, { plugin, count }] of after) {
    const was = before.get(k)?.count ?? 0
    const kind: PluginChangeKind = was === 0 ? 'added' : was !== count ? 'count' : 'same'
    changes.push({ kind, plugin, before: was, after: count })
  }
  for (const [k, { plugin, count }] of before) {
    if (!after.has(k)) changes.push({ kind: 'removed', plugin, before: count, after: 0 })
  }
  const rank: Record<PluginChangeKind, number> = { added: 0, removed: 1, count: 2, same: 3 }
  changes.sort((a, b) => rank[a.kind] - rank[b.kind] || a.plugin.name.localeCompare(b.plugin.name))
  return {
    changes,
    added: changes.filter(c => c.kind === 'added').length,
    removed: changes.filter(c => c.kind === 'removed').length,
    countChanged: changes.filter(c => c.kind === 'count').length,
  }
}
