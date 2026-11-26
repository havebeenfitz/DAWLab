/**
 * Song-level facts of a stored version: tempo, tracks, key, time signature,
 * sample rate and audio files. Logic keeps them in each alternative's
 * MetaData.plist; Ableton in the .als itself. Read from DAWLab storage, so
 * this works for any version, including ones pulled from a shared folder.
 */
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { XMLParser } from 'fast-xml-parser'
import { getCasPath } from '../core/cas'
import type { FileMapEntry } from '../types'
import { keyName, type SongInfo } from '../../../shared/song-diff'
import { parsePlist, type PlistValue } from '../../workers/bplist'

type Dict = { [key: string]: PlistValue }
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

// ------------------------------------------------------------------ Logic

/** Song facts from a Logic MetaData.plist (binary or XML). */
export function songInfoFromLogicMetadata(data: Buffer): SongInfo {
  const meta = parsePlist(data)
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || Buffer.isBuffer(meta) || meta instanceof Date) {
    throw new Error('MetaData.plist is not a dictionary')
  }
  const d = meta as Dict
  const key = str(d.SongKey)
  const mode = str(d.SongGenderKey)
  const numerator = num(d.SongSignatureNumerator)
  const denominator = num(d.SongSignatureDenominator)
  const files = Array.isArray(d.AudioFiles) ? d.AudioFiles.filter((f): f is string => typeof f === 'string') : undefined
  return {
    tempo: num(d.BeatsPerMinute),
    tracks: num(d.NumberOfTracks),
    key: key ? (mode ? `${key} ${mode}` : key) : undefined,
    timeSignature: numerator && denominator ? `${numerator}/${denominator}` : undefined,
    sampleRate: num(d.SampleRate),
    audioFiles: files,
  }
}

/** The MetaData.plist of the alternative whose ProjectData is `projectData`. */
const metadataPathFor = (projectData: string) => `${path.posix.dirname(projectData)}/MetaData.plist`

// ---------------------------------------------------------------- Ableton

/** Song facts from the bytes of an .als file (gzipped or plain XML). */
export function songInfoFromAls(data: Buffer): SongInfo {
  let xml: string
  try {
    xml = zlib.gunzipSync(data).toString('utf8')
  } catch {
    xml = data.toString('utf8')
  }
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml)
  const set = doc?.Ableton?.LiveSet
  if (!set) throw new Error('Not an Ableton Live set')

  const v = (node: any) => node?.['@_Value']
  const count = (x: unknown) => (Array.isArray(x) ? x.length : x ? 1 : 0)
  const tracks = set.Tracks ? count(set.Tracks.AudioTrack) + count(set.Tracks.MidiTrack) + count(set.Tracks.GroupTrack) + count(set.Tracks.ReturnTrack) : undefined
  const master = set.MasterTrack ?? set.MainTrack
  const tempo = Number(v(master?.DeviceChain?.Mixer?.Tempo?.Manual))
  const sig = findFirst(master ?? set, 'RemoteableTimeSignature')
  const numerator = Number(v(sig?.Numerator))
  const denominator = Number(v(sig?.Denominator))
  const scale = set.ScaleInformation
  const root = scale ? Number(v(scale.RootNote) ?? v(scale.Root)) : NaN

  return {
    tempo: Number.isFinite(tempo) && tempo > 0 ? tempo : undefined,
    tracks,
    key: Number.isFinite(root) ? keyName(root, str(v(scale?.Name))) : undefined,
    timeSignature: numerator > 0 && denominator > 0 ? `${numerator}/${denominator}` : undefined,
    audioFiles: sampleFiles(set),
  }
}

function findFirst(root: any, key: string): any {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (node[key]) return Array.isArray(node[key]) ? node[key][0] : node[key]
    for (const [k, child] of Object.entries(node)) if (!k.startsWith('@_') && child && typeof child === 'object') stack.push(child)
  }
  return undefined
}

/** Every sample the set refers to, by its project-relative path when Live stored one. */
function sampleFiles(root: any): string[] {
  const files = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) { for (const n of node) stack.push(n); continue }
    const list = (x: unknown) => (Array.isArray(x) ? x : x ? [x] : [])
    const refs = list(node.SampleRef).flatMap((r: any) => list(r?.FileRef))
    for (const fileRef of refs as any[]) {
      const rel = str(fileRef?.RelativePath?.['@_Value'])
      const abs = str(fileRef?.Path?.['@_Value'])
      const name = str(fileRef?.Name?.['@_Value'])
      const file = rel ?? (abs ? path.basename(abs) : name)
      if (file) files.add(file)
    }
    for (const [k, child] of Object.entries(node)) if (!k.startsWith('@_') && child && typeof child === 'object') stack.push(child)
  }
  return [...files].sort((a, b) => a.localeCompare(b))
}

// ------------------------------------------------------------------ version

// Song facts only depend on the file's content, so cache them by its hash.
const cache = new Map<string, SongInfo>()

function cached(key: string, read: () => SongInfo): SongInfo {
  const hit = cache.get(key)
  if (hit) return hit
  const info = read()
  if (cache.size >= 200) cache.delete(cache.keys().next().value as string)
  cache.set(key, info)
  return info
}

/**
 * Song facts of one version, or null when they can't be read.
 * For Logic with several alternatives, the one changed since `previous` wins,
 * then the first.
 */
export function songInfoOfVersion(
  fileMap: FileMapEntry[],
  daw: string,
  casDir: string,
  previous: FileMapEntry[] | null = null,
  read: (e: FileMapEntry) => Buffer = (e) => fs.readFileSync(getCasPath(e.hash, casDir)),
): SongInfo | null {
  const files = fileMap.filter((e) => e.hash !== 'empty')
  try {
    if (/logic/i.test(daw)) {
      const metas = files.filter((e) => /\.logicx\/(?:Alternatives\/[^/]+\/)?MetaData\.plist$/.test(e.path)).sort((a, b) => a.path.localeCompare(b.path))
      if (metas.length === 0) return null
      const before = new Map((previous ?? []).map((e) => [e.path, e.hash]))
      const projectData = files.filter((e) => /ProjectData$/.test(e.path))
      const changedAlt = projectData.find((e) => before.has(e.path) && before.get(e.path) !== e.hash)
      const pick = (changedAlt && metas.find((m) => m.path === metadataPathFor(changedAlt.path))) ?? metas[0]
      return cached(`logic:${pick.hash}`, () => songInfoFromLogicMetadata(read(pick)))
    }
    if (/ableton/i.test(daw)) {
      const als = files.filter((e) => e.path.toLowerCase().endsWith('.als') && !/(^|\/)backup\//i.test(e.path))
      const pick = als.find((e) => !e.path.includes('/')) ?? als[0]
      if (!pick) return null
      return cached(`ableton:${pick.hash}`, () => songInfoFromAls(read(pick)))
    }
  } catch (err) {
    console.warn('[song-info] Could not read song info:', (err as Error).message)
  }
  return null
}
