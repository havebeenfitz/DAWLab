/**
 * Reads what a Logic Pro project contains from its ProjectData file: markers,
 * tempo changes, channel strips (volume, pan, mute, solo, plugins), audio
 * regions (where they sit and how long they are), MIDI notes and automation.
 *
 * The format is Apple's and undocumented. What is here was measured on real
 * projects, one edit per save (docs/research). Every value is range-checked:
 * when something doesn't look right the facts say so (`trusted: false`) and
 * callers fall back to "the Logic project changed" instead of guessing.
 * Read-only: DAWLab never writes ProjectData.
 *
 * Pure and dependency-free (Uint8Array in, plain objects out): shared by the
 * app, the main process and tests.
 */

/** Logic's internal position of bar 1, beat 1, and its resolution. */
export const BAR1 = 38400
export const PPQ = 960

export interface LogicMarker { pos: number; name: string }
export interface LogicTempo { pos: number; bpm: number }
export interface LogicPlugin { name: string; bypassed: boolean }
export interface LogicStrip {
  /** Stable within a project: the strip object's id. */
  id: string
  name: string
  /** Fader position, 90 = 0 dB (Logic's own scale). */
  volume: number
  /** -64 (left) to +63 (right), 0 = centre. */
  pan: number
  mute: boolean
  solo: boolean
  plugins: LogicPlugin[]
}
export interface LogicRegion {
  /** The region object's id, as the track's placement refers to it. */
  id: string
  name: string
  /** Where it starts in the song, in ticks; null when it isn't placed on a track. */
  pos: number | null
  /** Length and start within its audio file, in samples. */
  length: number
  offset: number
}
export interface LogicFacts {
  /** False when some value was outside its range: show changes as "Logic project changed" only. */
  trusted: boolean
  problems: string[]
  markers: LogicMarker[]
  tempo: LogicTempo[]
  strips: LogicStrip[]
  regions: LogicRegion[]
  /** Every MIDI note as "pos:pitch:velocity:length:channel", sorted. */
  notes: string[]
  /** Automation points as "parameter:pos:value", sorted. */
  automation: string[]
}

interface Obj { tag: string; cls: number; id10: number; id14: number; idHex: string; data: Uint8Array }

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000

/** The objects of a ProjectData file: 24-byte header, then [reversed tag, header, u64 length at +28, data at +36]. */
export function logicObjects(buf: Uint8Array): Obj[] | null {
  const out: Obj[] = []
  let pos = 24
  while (pos + 36 <= buf.length) {
    const tag = String.fromCharCode(buf[pos + 3], buf[pos + 2], buf[pos + 1], buf[pos])
    const len = u32(buf, pos + 28) + u32(buf, pos + 32) * 0x100000000
    if (!/^[A-Za-z]{4}$/.test(tag) || pos + 36 + len > buf.length) return out.length ? out : null
    const hdr = buf.subarray(pos, pos + 36)
    out.push({
      tag, cls: u16(hdr, 6), id10: u16(hdr, 10), id14: u16(hdr, 14),
      idHex: Array.from(hdr.subarray(8, 16), (x) => x.toString(16).padStart(2, '0')).join(''),
      data: buf.subarray(pos + 36, pos + 36 + len),
    })
    pos += 36 + len
  }
  return out
}

/** Readable names in a binary blob: runs of printable characters with at least two letters. */
function names(d: Uint8Array, max = 1): string[] {
  const out: string[] = []
  let start = -1
  const flush = (end: number) => {
    if (start < 0) return
    const bytes = d.subarray(start, end)
    start = -1
    if (bytes.length < 3) return
    let s: string
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim() } catch { return }
    if ((s.match(/\p{L}/gu) ?? []).length >= 2 && !s.startsWith('{\\') && !s.startsWith('\\')) out.push(s)
  }
  for (let i = 0; i < d.length && out.length < max; i++) {
    const c = d[i]
    const printable = (c >= 0x20 && c < 0x7f) || c >= 0x80
    if (printable) { if (start < 0 && ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c >= 0xc0)) start = i }
    else flush(i)
  }
  flush(d.length)
  return out.slice(0, max)
}

const has = (d: Uint8Array, text: string) => {
  const t = Array.from(text, (c) => c.charCodeAt(0))
  outer: for (let i = 0; i + t.length <= d.length; i++) {
    for (let j = 0; j < t.length; j++) if (d[i + j] !== t[j]) continue outer
    return true
  }
  return false
}

const NOT_PLUGIN = new Set(['GAME', 'MELC', 'PShft', 'NSKeyedArchiver', 'Audio Recording'])

/** Facts of one ProjectData file. Never throws: an unreadable file gives untrusted, empty facts. */
export function readLogicFacts(buf: Uint8Array): LogicFacts {
  const facts: LogicFacts = { trusted: true, problems: [], markers: [], tempo: [], strips: [], regions: [], notes: [], automation: [] }
  const problem = (p: string) => { facts.trusted = false; if (facts.problems.length < 10) facts.problems.push(p) }
  let objs: Obj[] | null
  try { objs = logicObjects(buf) } catch { objs = null }
  if (!objs) { problem('not a Logic project file'); return facts }

  try {
    // Markers: names in TxSq objects; positions in the marker track (EvSq class 5): cell 0x12, next cell = TxSq id.
    const markerNames = new Map<number, string>()
    for (const o of objs) {
      if (o.tag !== 'TxSq') continue
      const t = names(o.data, 5).filter((x) => x !== '//RR')
      if (t[0]?.startsWith('rtf1')) continue // notes text, not a marker name
      markerNames.set(o.id10, t[0] ?? '')
    }
    const placements = new Map<string, number>() // region id -> position
    for (const o of objs) {
      if (o.tag !== 'EvSq') continue
      const d = o.data
      const cells = Math.floor(d.length / 16)
      const tempoSeq = cells > 1 && Array.from({ length: cells }, (_, k) => d[k * 16]).every((s, k, all) => s === 0x60 || s === 0xf1 || (k > 0 && all[k - 1] === 0x60))
      for (let i = 0; i + 32 <= d.length; i += 16) {
        const s = d[i]
        if (o.cls === 5 && s === 0x12 && d[i + 23] === 0x88) {
          const name = markerNames.get(u32(d, i + 16))
          if (name !== undefined) facts.markers.push({ pos: u32(d, i + 4), name: name || '(untitled)' })
        } else if (tempoSeq && s === 0x60) {
          const bpm = u32(d, i + 16) / 10000
          if (bpm < 5 || bpm > 990) problem(`tempo ${bpm}`)
          facts.tempo.push({ pos: u32(d, i + 4), bpm })
          i += 16
        } else if ((s & 0xf0) === 0x90 && d[i + 16] === 0x40) {
          const pitch = d[i + 12], vel = d[i + 11]
          if (pitch > 127 || vel > 127) problem(`note ${pitch}/${vel}`)
          facts.notes.push(`${u24(d, i + 4)}:${pitch}:${vel}:${u24(d, i + 28)}:${s & 0x0f}`)
          i += 16
        } else if (s === 0x50) {
          facts.automation.push(`${d[i + 12]}:${u32(d, i + 4)}:${d[i + 11]}`)
        } else if ((s === 0x20 || s === 0x24) && i + 80 <= d.length && d[i + 23] === 0x89 && d[i + 31] === 0x3f) {
          // A region on a track: five cells. 0x24 = audio region, its id in the third cell.
          if (s === 0x24 && d[i + 39] === 0xbc) placements.set(`${u16(d, i + 40)}:${u16(d, i + 44)}`, u32(d, i + 4))
          i += 64
        }
      }
    }
    facts.markers.sort((a, b) => a.pos - b.pos || a.name.localeCompare(b.name))
    facts.tempo.sort((a, b) => a.pos - b.pos)
    facts.notes.sort()
    facts.automation.sort()

    // Audio regions: name, start in file (+6) and length (+22), in samples.
    for (const o of objs) {
      if (o.tag !== 'AuRg' || o.data.length < 26) continue
      const id = `${o.id14}:${o.id10}`
      facts.regions.push({
        id, name: (names(o.data)[0] ?? '').replace(/[\s:]+$/, ''),
        pos: placements.get(id) ?? null, length: u32(o.data, 22), offset: u32(o.data, 6),
      })
    }

    // Channel strips (AuCO) and their plugins (AuCU objects with the same id; the first of each plugin carries its name).
    const pluginsOf = new Map<string, LogicPlugin[]>()
    for (const o of objs) {
      if (o.tag !== 'AuCU' || o.data.length < 120 || o.data[112] > 1 || has(o.data.subarray(0, 128), 'bplist00')) continue
      const name = names(o.data, 6).find((n) => !/\.(pst|aupreset|cst|patch)$/i.test(n) && !NOT_PLUGIN.has(n))
      if (!name) continue
      const list = pluginsOf.get(o.idHex) ?? []
      list.push({ name, bypassed: o.data[112] === 1 })
      pluginsOf.set(o.idHex, list)
    }
    for (const o of objs) {
      if (o.tag !== 'AuCO' || o.data.length < 120) continue
      const d = o.data
      const name = names(d)[0] ?? ''
      // Inputs are not mixer channels people work with.
      if (/^Input \d+$/.test(name)) continue
      const volume = d[116] / 256 / 256 / 256 + d[117] / 256 / 256 + d[118] / 256 + d[119]
      if (d[85] > 127 || volume > 128 || d[89] > 127) { problem(`strip values ${d[85]}/${d[89]}`); continue }
      facts.strips.push({
        id: o.idHex, name, volume: Math.round(volume * 100) / 100,
        pan: d[89] - 64, mute: (d[90] & 1) === 1, solo: (d[88] & 1) === 1, plugins: pluginsOf.get(o.idHex) ?? [],
      })
    }
  } catch (err) {
    problem(`read error: ${(err as Error)?.message ?? err}`)
  }
  return facts
}

// ------------------------------------------------------------------ positions

/** "12" or "12.3" (bar, beat) for a position, given the song's time signature. */
export function barOf(pos: number, num = 4, den = 4): string {
  const beat = (PPQ * 4) / (den || 4)
  const beats = Math.max(0, pos - BAR1) / beat
  const bar = Math.floor(beats / (num || 4)) + 1
  const inBar = Math.floor(beats % (num || 4)) + 1
  return inBar === 1 ? String(bar) : `${bar}.${inBar}`
}

// ------------------------------------------------------------------ diff

export type LogicChangeKind =
  | 'marker-added' | 'marker-removed' | 'marker-moved' | 'tempo'
  | 'strip-added' | 'strip-removed' | 'strip' | 'plugin-removed'
  | 'region-added' | 'region-removed' | 'region-moved' | 'region-length'
  | 'notes' | 'automation' | 'other'

export interface LogicChange {
  kind: LogicChangeKind
  /** One line for people: "Marker “Intro” added at bar 11". */
  text: string
  /** True for things that disappeared: what a "you are about to lose" warning lists. */
  loss?: boolean
  /** For a line that stands for many ("34 regions added"): each of them. */
  items?: string[]
}

export interface DiffOptions { signature?: [number, number]; sampleRate?: number }

const q = (s: string) => `“${s}”`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function counter(items: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1)
  return m
}
/** Items of `a` not in `b`, as a multiset. */
function minus(a: string[], b: string[]): string[] {
  const left = counter(b)
  const out: string[] = []
  for (const i of a) {
    const n = left.get(i) ?? 0
    if (n > 0) left.set(i, n - 1)
    else out.push(i)
  }
  return out
}

const seconds = (samples: number, rate: number) => {
  const s = samples / rate
  return s >= 10 ? `${Math.round(s)} s` : `${s.toFixed(1)} s`
}

/**
 * What changed in the project from `a` to `b`, as lines people can read.
 * Untrusted facts on either side give one line: "Logic project changed".
 */
export function diffLogicFacts(a: LogicFacts, b: LogicFacts, opts: DiffOptions = {}): LogicChange[] {
  if (!a.trusted || !b.trusted) return [{ kind: 'other', text: 'Logic project changed (details not readable for this Logic version)' }]
  const [num, den] = opts.signature ?? [4, 4]
  const bar = (p: number) => barOf(p, num, den)
  const rate = opts.sampleRate || 44100
  const out: LogicChange[] = []

  // Markers: same name at another position is a move.
  const ma = a.markers.map((m) => `${m.name}@${m.pos}`), mb = b.markers.map((m) => `${m.name}@${m.pos}`)
  const gone = minus(ma, mb).map((k) => a.markers.find((m) => `${m.name}@${m.pos}` === k)!)
  const added = minus(mb, ma).map((k) => b.markers.find((m) => `${m.name}@${m.pos}` === k)!)
  for (const m of [...gone]) {
    const j = added.findIndex((x) => x.name === m.name)
    if (j < 0) continue
    out.push({ kind: 'marker-moved', text: `Marker ${q(m.name)} moved from bar ${bar(m.pos)} to ${bar(added[j].pos)}` })
    added.splice(j, 1); gone.splice(gone.indexOf(m), 1)
  }
  for (const m of added) out.push({ kind: 'marker-added', text: `Marker ${q(m.name)} added at bar ${bar(m.pos)}` })
  for (const m of gone) out.push({ kind: 'marker-removed', text: `Marker ${q(m.name)} removed (was at bar ${bar(m.pos)})`, loss: true })

  // Tempo map: the first point is the song tempo (already shown from the song settings); later points are tempo changes.
  const tk = (t: LogicTempo) => `${t.pos}:${t.bpm}`
  const ta = a.tempo.map(tk), tb = b.tempo.map(tk)
  if (ta.join() !== tb.join()) {
    const fmt = (t: LogicTempo) => `${Math.round(t.bpm * 100) / 100} BPM at bar ${bar(t.pos)}`
    const firstA = a.tempo[0], firstB = b.tempo[0]
    if (firstA && firstB && firstA.bpm !== firstB.bpm) out.push({ kind: 'tempo', text: `Tempo ${Math.round(firstA.bpm * 100) / 100} → ${Math.round(firstB.bpm * 100) / 100} BPM` })
    for (const k of minus(tb.slice(1), ta.slice(1))) out.push({ kind: 'tempo', text: `Tempo change added: ${fmt(b.tempo.find((t) => tk(t) === k)!)}` })
    for (const k of minus(ta.slice(1), tb.slice(1))) out.push({ kind: 'tempo', text: `Tempo change removed: ${fmt(a.tempo.find((t) => tk(t) === k)!)}` })
  }

  // Channel strips: matched by name (ids shift when strips are inserted), then by id (a rename).
  // One line per strip. Solo mutes every other strip in Logic's file; only the strip's own solo counts.
  const used = new Set<string>()
  const pairs: Array<[LogicStrip, LogicStrip | null]> = []
  for (const s of a.strips) {
    const t = b.strips.find((x) => x.name === s.name && !used.has(x.id)) ?? null
    if (t) used.add(t.id)
    pairs.push([s, t])
  }
  for (const pair of pairs) {
    if (pair[1]) continue
    const t = b.strips.find((x) => x.id === pair[0].id && !used.has(x.id))
    if (t) { used.add(t.id); pair[1] = t }
  }
  for (const [s, t] of pairs) {
    if (!t) {
      if (s.name) out.push({ kind: 'strip-removed', text: `Channel strip ${q(s.name)} removed`, loss: true })
      continue
    }
    const parts: string[] = []
    if (s.name !== t.name) parts.push(`renamed from ${q(s.name)}`)
    if (Math.abs(s.volume - t.volume) >= 0.01) parts.push(`volume ${t.volume > s.volume ? 'up' : 'down'}`)
    if (s.pan !== t.pan) parts.push(`pan ${panText(s.pan)} → ${panText(t.pan)}`)
    if (s.mute !== t.mute) parts.push(t.mute ? 'muted' : 'unmuted')
    if (s.solo !== t.solo) parts.push(t.solo ? 'solo on' : 'solo off')
    const pa = s.plugins.map((p) => p.name), pb = t.plugins.map((p) => p.name)
    const addedP = minus(pb, pa), goneP = minus(pa, pb)
    if (addedP.length) parts.push(`${addedP.length === 1 ? 'plugin' : 'plugins'} ${addedP.join(', ')} added`)
    for (const p of t.plugins) {
      const before = s.plugins.find((x) => x.name === p.name)
      if (before && before.bypassed !== p.bypassed) parts.push(`${p.name} ${p.bypassed ? 'bypassed' : 'switched back on'}`)
    }
    const who = q(t.name || 'channel strip')
    if (parts.length) out.push({ kind: 'strip', text: `${who}: ${parts.join(', ')}` })
    if (goneP.length) out.push({ kind: 'plugin-removed', text: `${who}: ${goneP.length === 1 ? 'plugin' : 'plugins'} ${goneP.join(', ')} removed`, loss: true })
  }
  for (const t of b.strips) {
    if (!used.has(t.id) && t.name) out.push({ kind: 'strip-added', text: `Channel strip ${q(t.name)} added` })
  }

  // Audio regions by id.
  const rb = new Map(b.regions.map((r) => [r.id, r]))
  const ra = new Map(a.regions.map((r) => [r.id, r]))
  const label = (r: LogicRegion) => q(r.name || 'region')
  for (const r of a.regions) {
    const t = rb.get(r.id)
    if (!t) { out.push({ kind: 'region-removed', text: `Region ${label(r)} removed${r.pos !== null ? ` (was at bar ${bar(r.pos)})` : ''}`, loss: true }); continue }
    if (r.pos !== null && t.pos !== null && r.pos !== t.pos) {
      const from = bar(r.pos), to = bar(t.pos)
      out.push({ kind: 'region-moved', text: from === to ? `Region ${label(t)} nudged at bar ${to}` : `Region ${label(t)} moved from bar ${from} to ${to}` })
    }
    if (r.length !== t.length || r.offset !== t.offset) {
      const d = t.length - r.length
      out.push({ kind: 'region-length', text: d === 0 ? `Region ${label(t)} trimmed` : `Region ${label(t)} ${d > 0 ? 'lengthened' : 'shortened'} by ${seconds(Math.abs(d), rate)}` })
    }
  }
  for (const t of b.regions) {
    if (!ra.has(t.id)) out.push({ kind: 'region-added', text: `Region ${label(t)} added${t.pos !== null ? ` at bar ${bar(t.pos)}` : ''}` })
  }

  // MIDI notes and automation: counts.
  const nAdd = minus(b.notes, a.notes).length, nGone = minus(a.notes, b.notes).length
  if (nAdd || nGone) {
    const parts = [nAdd ? `${nAdd} added` : '', nGone ? `${nGone} removed` : ''].filter(Boolean).join(', ')
    out.push({ kind: 'notes', text: `MIDI notes: ${parts}`, loss: nGone > 0 && nAdd === 0 })
  }
  const aAdd = minus(b.automation, a.automation).length, aGone = minus(a.automation, b.automation).length
  if (aAdd || aGone) {
    const parts = [aAdd ? `${aAdd} added` : '', aGone ? `${aGone} removed` : ''].filter(Boolean).join(', ')
    out.push({ kind: 'automation', text: `Automation points: ${parts}` })
  }
  return groupMany(out)
}

const GROUPS: Partial<Record<LogicChangeKind, (n: number) => string>> = {
  'region-added': (n) => `${n} regions added`,
  'region-removed': (n) => `${n} regions removed`,
  'region-moved': (n) => `${n} regions moved`,
  'region-length': (n) => `${n} regions trimmed`,
  'strip-added': (n) => `${n} channel strips added`,
  'strip-removed': (n) => `${n} channel strips removed`,
  'marker-added': (n) => `${n} markers added`,
  'marker-removed': (n) => `${n} markers removed`,
}

/** More than four lines of one kind become one line that lists them. */
function groupMany(lines: LogicChange[], max = 4): LogicChange[] {
  const out: LogicChange[] = []
  const done = new Set<LogicChangeKind>()
  for (const c of lines) {
    const title = GROUPS[c.kind]
    const same = title ? lines.filter((x) => x.kind === c.kind) : []
    if (!title || same.length <= max) { out.push(c); continue }
    if (done.has(c.kind)) continue
    done.add(c.kind)
    out.push({ kind: c.kind, text: title(same.length), loss: same.some((x) => x.loss), items: same.map((x) => x.text) })
  }
  return out
}

const panText = (p: number) => (p === 0 ? 'centre' : p < 0 ? `L${-p}` : `R${p}`)

/**
 * What the project had in `parent` that `next` no longer has: markers, channel
 * strips, regions, plugins and MIDI notes. Only from trusted facts on both sides;
 * otherwise nothing (a warning must never be a guess).
 */
export function lostSince(parent: LogicFacts, next: LogicFacts, opts: DiffOptions = {}): LogicChange[] {
  if (!parent.trusted || !next.trusted) return []
  const lost = diffLogicFacts(parent, next, opts).filter((c) => c.loss)
  // Notes removed while others were added is editing, not loss; a drop to far fewer notes is worth a look.
  const gone = minus(parent.notes, next.notes).length
  if (gone > 0 && !lost.some((c) => c.kind === 'notes') && gone >= Math.max(8, parent.notes.length / 5)) {
    lost.push({ kind: 'notes', text: `${plural(gone, 'MIDI note')} removed`, loss: true })
  }
  return lost
}

/** Short summary for notifications: the first few lines, then "and N more". */
export function summarizeChanges(changes: LogicChange[], max = 3): string {
  if (changes.length === 0) return ''
  const head = changes.slice(0, max).map((c) => c.text).join('; ')
  return changes.length > max ? `${head}; and ${changes.length - max} more` : head
}
