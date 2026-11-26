/**
 * What changed inside a Logic project, read from its ProjectData files
 * (shared/logic-project.ts): between two versions, between the folder and its
 * version, and what a new version would lose compared with its parent.
 */
import fs from 'fs'
import path from 'path'
import { getCasPath } from '../core/cas'
import type { FileMapEntry } from '../types'
import { readLogicFacts, diffLogicFacts, lostSince, type LogicFacts, type LogicChange, type DiffOptions } from '../../../shared/logic-project'
import { songInfoFromLogicMetadata } from './song-info'
import { mergePlan, type MergePlan } from '../../../shared/logic-merge'
import { loadLocalProjectLog } from '../core/log'
import { getCommitFileMap } from '../core/commits'
import { getProjectPath } from '../core/registry'
import { getProjectStorageDirs } from '../core/storage-location'
import { parentForNewVersion } from './commit'

const DATA = /\.logicx\/(?:Alternatives\/([^/]+)\/)?ProjectData$/
const MAX_CACHE = 60

const blobFacts = new Map<string, LogicFacts>()
const fileFacts = new Map<string, { size: number; mtimeMs: number; facts: LogicFacts }>()

function remember<V>(m: Map<string, V>, k: string, v: V) {
  if (m.size >= MAX_CACHE) m.delete(m.keys().next().value as string)
  m.set(k, v)
}

export function factsOfBlob(hash: string, casDir: string): LogicFacts | null {
  const hit = blobFacts.get(hash)
  if (hit) return hit
  try {
    const facts = readLogicFacts(fs.readFileSync(getCasPath(hash, casDir)))
    remember(blobFacts, hash, facts)
    return facts
  } catch {
    return null
  }
}

export function factsOfFile(full: string): LogicFacts | null {
  try {
    const st = fs.statSync(full)
    const hit = fileFacts.get(full)
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.facts
    const facts = readLogicFacts(fs.readFileSync(full))
    remember(fileFacts, full, { size: st.size, mtimeMs: st.mtimeMs, facts })
    return facts
  } catch {
    return null
  }
}

/** ProjectData files of a version, by path. */
export const logicDataEntries = (map: FileMapEntry[]) => map.filter((e) => e.hash !== 'empty' && DATA.test(e.path))

const metadataPath = (dataPath: string) => dataPath.replace(/ProjectData$/, 'MetaData.plist')
const alternativeLabel = (dataPath: string) => {
  const alt = dataPath.match(DATA)?.[1]
  return alt ? `Alternative ${alt}` : ''
}

/** Time signature and sample rate of an alternative, so bars and seconds read right. */
function optionsFrom(read: (p: string) => Buffer | null, dataPath: string): DiffOptions {
  const meta = read(metadataPath(dataPath))
  if (!meta) return {}
  try {
    const info = songInfoFromLogicMetadata(meta)
    const sig = info.timeSignature?.match(/^(\d+)\/(\d+)$/)
    return { signature: sig ? [Number(sig[1]), Number(sig[2])] : undefined, sampleRate: info.sampleRate }
  } catch {
    return {}
  }
}

const blobReader = (map: FileMapEntry[], casDir: string) => (p: string) => {
  const e = map.find((x) => x.path === p && x.hash !== 'empty')
  try { return e ? fs.readFileSync(getCasPath(e.hash, casDir)) : null } catch { return null }
}
const folderReader = (root: string) => (p: string) => {
  try { return fs.readFileSync(path.join(root, p)) } catch { return null }
}

/** Facts on one side: a version (file map + storage) or the project folder. */
export type Side =
  | { kind: 'version'; map: FileMapEntry[]; casDir: string }
  | { kind: 'folder'; root: string; dataPaths: string[] }

function sideData(side: Side): Array<{ path: string; facts: () => LogicFacts | null; read: (p: string) => Buffer | null }> {
  if (side.kind === 'version') {
    const read = blobReader(side.map, side.casDir)
    return logicDataEntries(side.map).map((e) => ({ path: e.path, facts: () => factsOfBlob(e.hash, side.casDir), read }))
  }
  const read = folderReader(side.root)
  return side.dataPaths.map((p) => ({ path: p, facts: () => factsOfFile(path.join(side.root, p)), read }))
}

/**
 * Lines describing what changed from `before` to `after`, per Logic alternative
 * that exists on both sides. Null when there is no Logic project data to read.
 */
export function logicChangesBetween(before: Side | null, after: Side, mode: 'changes' | 'losses' = 'changes'): LogicChange[] | null {
  const now = sideData(after)
  if (now.length === 0) return null
  if (!before) return []
  const then = new Map(sideData(before).map((x) => [x.path, x]))
  const out: LogicChange[] = []
  const many = now.filter((x) => then.has(x.path)).length > 1
  for (const cur of now) {
    const prev = then.get(cur.path)
    if (!prev) continue
    const a = prev.facts(), b = cur.facts()
    if (!a || !b) continue
    const opts = optionsFrom(cur.read, cur.path)
    const lines = mode === 'losses' ? lostSince(a, b, opts) : diffLogicFacts(a, b, opts)
    const prefix = many ? `${alternativeLabel(cur.path)}: ` : ''
    for (const l of lines) out.push(prefix ? { ...l, text: prefix + l.text } : l)
  }
  return out
}

/** The ProjectData paths in a project folder (relative), as found on disk. */
export function folderDataPaths(root: string, candidates: string[]): string[] {
  return candidates.filter((p) => DATA.test(p) && fs.existsSync(path.join(root, p)))
}

// ------------------------------------------------------------------ project-level helpers


function versionSide(projectName: string, commitId: string): Side | null {
  try {
    const { commitsDir, casDir } = getProjectStorageDirs(projectName)
    return { kind: 'version', map: getCommitFileMap(projectName, commitId, commitsDir), casDir }
  } catch {
    return null
  }
}

function folderSide(projectName: string, like: Side | null): Side | null {
  const root = getProjectPath(projectName)
  if (!root || root === 'NA' || !fs.existsSync(root)) return null
  // The ProjectData files the version has, plus any new alternative found next to them.
  const known = like?.kind === 'version' ? logicDataEntries(like.map).map((e) => e.path) : []
  const found = new Set(known)
  for (const p of known) {
    const altDir = path.join(root, p.replace(/\/Alternatives\/[^/]+\/ProjectData$/, '/Alternatives'))
    try {
      for (const alt of fs.readdirSync(altDir)) found.add(path.relative(root, path.join(altDir, alt, 'ProjectData')).split(path.sep).join('/'))
    } catch { /* single alternative */ }
  }
  return { kind: 'folder', root, dataPaths: folderDataPaths(root, [...found]) }
}

/** What changed in the Logic project in the folder since version `baseId` (the unsaved changes, in words). */
export function workingLogicChanges(projectName: string, baseId: string | null): LogicChange[] | null {
  if (!baseId) return null
  const base = versionSide(projectName, baseId)
  const folder = folderSide(projectName, base)
  if (!base || !folder) return null
  return logicChangesBetween(base, folder)
}

/**
 * Before saving a version: what the folder no longer has that the version it
 * will be saved on top of had (markers, channel strips, regions, plugins, notes).
 * Empty when nothing is missing or the project can't be read with confidence.
 */
export function lossesBeforeSave(projectName: string, branch?: string): { parentId: string | null; parentMessage: string | null; lost: LogicChange[] } {
  const log = loadLocalProjectLog(projectName)
  if (!log || !/logic/i.test(String(log.daw ?? ''))) return { parentId: null, parentMessage: null, lost: [] }
  const parentId = parentForNewVersion(log, branch || log.current_branch || 'main') ?? null
  if (!parentId) return { parentId: null, parentMessage: null, lost: [] }
  const parentMessage = (log.branches ?? []).flatMap((b: any) => b.commits ?? []).find((c: any) => String(c.commit_id) === parentId)?.message ?? null
  const base = versionSide(projectName, parentId)
  const folder = folderSide(projectName, base)
  if (!base || !folder) return { parentId, parentMessage, lost: [] }
  return { parentId, parentMessage, lost: logicChangesBetween(base, folder, 'losses') ?? [] }
}

/**
 * The to-do list for bringing a parallel version (`theirsId`) into the project
 * folder, which holds your line (`mineId` is its newest version); `parentId` is
 * the version both saved on top of. Per Logic alternative that both have; null
 * when the project data isn't on this Mac.
 */
export function mergePlanFor(projectName: string, parentId: string, mineId: string, theirsId: string): Array<MergePlan & { alternative: string }> | null {
  const base = versionSide(projectName, parentId)
  const mine = versionSide(projectName, mineId)
  const theirs = versionSide(projectName, theirsId)
  if (!base || !mine || !theirs || base.kind !== 'version' || mine.kind !== 'version' || theirs.kind !== 'version') return null
  const folder = folderSide(projectName, theirs)
  if (!folder || folder.kind !== 'folder') return null
  const hashOf = (side: typeof base, p: string) => side.map.find((e) => e.path === p && e.hash !== 'empty')?.hash
  const out: Array<MergePlan & { alternative: string }> = []
  for (const e of logicDataEntries(theirs.map)) {
    const b = hashOf(base, e.path), m = hashOf(mine, e.path)
    if (!b || !m || !folder.dataPaths.includes(e.path)) continue
    if (b === e.hash) continue // they didn't touch this alternative
    const facts = [factsOfBlob(b, base.casDir), factsOfBlob(m, mine.casDir), factsOfBlob(e.hash, theirs.casDir), factsOfFile(path.join(folder.root, e.path))]
    if (facts.some((f) => !f)) continue
    const opts = optionsFrom(blobReader(theirs.map, theirs.casDir), e.path)
    out.push({ alternative: alternativeLabel(e.path), ...mergePlan(facts[0]!, facts[1]!, facts[2]!, facts[3]!, opts) })
  }
  return out
}
