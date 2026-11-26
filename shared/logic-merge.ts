/**
 * Two people saved on top of the same version of a Logic project. Logic can't
 * merge projects, but it can import tracks from another project (File > Import >
 * Logic Projects). This builds the to-do list for that: what the other side did
 * since the shared version, which of it the folder already has, which of it
 * clashes with what you did, and, after you saved in Logic, what is still missing.
 *
 * Steps are matched by what is heard and seen, never by object ids: an imported
 * track gets new ids in your project, but keeps its name, its regions'
 * positions and its notes.
 */
import { barOf, type DiffOptions, type LogicFacts, type LogicRegion, type LogicStrip } from './logic-project'

export type MergeStepKind = 'marker' | 'tempo' | 'strip' | 'plugin' | 'region' | 'notes' | 'automation'

export interface MergeStep {
  /** What the change is about ("strip:Bass:volume"): two sides touching the same key clash. */
  key: string
  kind: MergeStepKind
  text: string
  /** Your side changed the same thing another way. */
  conflict?: string
}

export interface MergePlan {
  /** Whether both sides could be read with confidence. False: no plan, only "compare by ear". */
  readable: boolean
  /** Their changes since the shared version that the folder doesn't have yet. */
  todo: MergeStep[]
  /** Their changes the folder already has (you did the same, or you brought them over). */
  done: MergeStep[]
  /** What you changed since the shared version, for reference. */
  yours: MergeStep[]
}

interface Step extends MergeStep {
  /** The value this side ended with: equal values on both sides are the same change. */
  value: string
  /** Does a project have this change? */
  has: (f: LogicFacts) => boolean
}

const q = (s: string) => `“${s}”`
const stripNamed = (f: LogicFacts, name: string) => f.strips.find((s) => s.name === name)
const sameRegion = (r: LogicRegion, name: string, pos: number | null, length?: number) =>
  r.name === name && r.pos === pos && (length === undefined || r.length === length)

function counter(items: string[]) {
  const m = new Map<string, number>()
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1)
  return m
}
function minus(a: string[], b: string[]) {
  const left = counter(b)
  return a.filter((i) => {
    const n = left.get(i) ?? 0
    if (n > 0) { left.set(i, n - 1); return false }
    return true
  })
}
/** Does `all` contain every item of `some` (as a multiset)? */
const containsAll = (all: string[], some: string[]) => minus(some, all).length === 0

/** Every change from `base` to `side`, one step per thing changed. */
function stepsBetween(base: LogicFacts, side: LogicFacts, opts: DiffOptions): Step[] {
  const [num, den] = opts.signature ?? [4, 4]
  const bar = (p: number) => barOf(p, num, den)
  const out: Step[] = []

  // Markers, by name.
  const names = new Set([...base.markers, ...side.markers].map((m) => m.name))
  for (const name of names) {
    const was = base.markers.filter((m) => m.name === name).map((m) => m.pos).sort((a, b) => a - b)
    const now = side.markers.filter((m) => m.name === name).map((m) => m.pos).sort((a, b) => a - b)
    if (was.join() === now.join()) continue
    const value = now.join()
    const has = (f: LogicFacts) => f.markers.filter((m) => m.name === name).map((m) => m.pos).sort((a, b) => a - b).join() === value
    const text = now.length === 0
      ? `Remove marker ${q(name)} (bar ${bar(was[0])})`
      : was.length === 0
        ? `Add marker ${q(name)} at bar ${now.map(bar).join(', ')}`
        : `Move marker ${q(name)} to bar ${now.map(bar).join(', ')}`
    out.push({ key: `marker:${name}`, kind: 'marker', text, value, has })
  }

  // Tempo: the song tempo, then each later tempo point.
  const first = (f: LogicFacts) => f.tempo[0]?.bpm
  if (first(base) !== undefined && first(side) !== undefined && first(base) !== first(side)) {
    const bpm = first(side)!
    out.push({ key: 'tempo:song', kind: 'tempo', text: `Set the tempo to ${Math.round(bpm * 100) / 100} BPM`, value: String(bpm), has: (f) => first(f) === bpm })
  }
  const pts = (f: LogicFacts) => f.tempo.slice(1).map((t) => `${t.pos}:${t.bpm}`)
  for (const k of minus(pts(side), pts(base))) {
    const [pos, bpm] = k.split(':').map(Number)
    out.push({ key: `tempo:${pos}`, kind: 'tempo', text: `Add a tempo change to ${Math.round(bpm * 100) / 100} BPM at bar ${bar(pos)}`, value: k, has: (f) => pts(f).includes(k) })
  }
  for (const k of minus(pts(base), pts(side))) {
    const pos = Number(k.split(':')[0])
    if (pts(side).some((x) => x.startsWith(`${pos}:`))) continue // changed, not removed: covered above
    out.push({ key: `tempo:${pos}`, kind: 'tempo', text: `Remove the tempo change at bar ${bar(pos)}`, value: 'none', has: (f) => !pts(f).includes(k) })
  }

  // Channel strips, by name (an imported track keeps its name). A rename is matched by id within one project.
  const matched = new Map<LogicStrip, LogicStrip>()
  for (const s of base.strips) {
    const t = stripNamed(side, s.name) ?? side.strips.find((x) => x.id === s.id && !base.strips.some((b) => b.name === x.name))
    if (t) matched.set(s, t)
  }
  const sideMatched = new Set(matched.values())
  for (const t of side.strips) {
    if (sideMatched.has(t) || !t.name) continue
    const plugins = t.plugins.map((p) => p.name)
    out.push({
      key: `strip:${t.name}`, kind: 'strip', value: 'present',
      text: `Bring over the track ${q(t.name)}${plugins.length ? ` (with ${plugins.join(', ')})` : ''}`,
      has: (f) => !!stripNamed(f, t.name),
    })
  }
  for (const s of base.strips) {
    if (matched.has(s) || !s.name) continue
    out.push({ key: `strip:${s.name}`, kind: 'strip', value: 'gone', text: `Delete the track ${q(s.name)} (they removed it)`, has: (f) => !stripNamed(f, s.name) })
  }
  for (const [s, t] of matched) {
    const name = t.name
    if (s.name !== t.name) {
      out.push({ key: `strip:${s.name}:name`, kind: 'strip', value: t.name, text: `Rename the track ${q(s.name)} to ${q(t.name)}`, has: (f) => !!stripNamed(f, t.name) })
    }
    const prop = (p: string, value: string, text: string, has: (x: LogicStrip) => boolean) =>
      out.push({ key: `strip:${name}:${p}`, kind: 'strip', value, text, has: (f) => { const x = stripNamed(f, name); return !!x && has(x) } })
    if (Math.abs(s.volume - t.volume) >= 0.01) prop('volume', t.volume.toFixed(2), `${q(name)}: set the volume ${t.volume > s.volume ? 'up' : 'down'} as in their version`, (x) => Math.abs(x.volume - t.volume) < 0.01)
    if (s.pan !== t.pan) prop('pan', String(t.pan), `${q(name)}: pan ${t.pan === 0 ? 'centre' : t.pan < 0 ? `L${-t.pan}` : `R${t.pan}`}`, (x) => x.pan === t.pan)
    if (s.mute !== t.mute) prop('mute', String(t.mute), `${q(name)}: ${t.mute ? 'mute' : 'unmute'}`, (x) => x.mute === t.mute)
    if (s.solo !== t.solo) prop('solo', String(t.solo), `${q(name)}: solo ${t.solo ? 'on' : 'off'}`, (x) => x.solo === t.solo)
    const pa = s.plugins.map((p) => p.name), pb = t.plugins.map((p) => p.name)
    for (const p of minus(pb, pa)) {
      out.push({ key: `plugin:${name}:${p}`, kind: 'plugin', value: 'present', text: `${q(name)}: add the plugin ${p}`, has: (f) => !!stripNamed(f, name)?.plugins.some((x) => x.name === p) })
    }
    for (const p of minus(pa, pb)) {
      out.push({ key: `plugin:${name}:${p}`, kind: 'plugin', value: 'gone', text: `${q(name)}: remove the plugin ${p}`, has: (f) => !stripNamed(f, name)?.plugins.some((x) => x.name === p) })
    }
    for (const p of t.plugins) {
      const before = s.plugins.find((x) => x.name === p.name)
      if (!before || before.bypassed === p.bypassed) continue
      out.push({
        key: `plugin:${name}:${p.name}:bypass`, kind: 'plugin', value: String(p.bypassed),
        text: `${q(name)}: ${p.bypassed ? 'bypass' : 'switch back on'} ${p.name}`,
        has: (f) => stripNamed(f, name)?.plugins.find((x) => x.name === p.name)?.bypassed === p.bypassed,
      })
    }
  }

  // Audio regions: by id within one project, then checked by name, position and length.
  const ra = new Map(base.regions.map((r) => [r.id, r]))
  const rb = new Map(side.regions.map((r) => [r.id, r]))
  const label = (r: LogicRegion) => q(r.name || 'region')
  for (const t of side.regions) {
    if (t.pos === null) continue
    const r = ra.get(t.id)
    if (r && r.pos === t.pos && r.length === t.length && r.offset === t.offset) continue
    const text = !r || r.pos === null
      ? `Bring over the region ${label(t)} at bar ${bar(t.pos)}`
      : r.pos !== t.pos ? `Move the region ${label(t)} to bar ${bar(t.pos)}` : `Trim the region ${label(t)} as in their version`
    out.push({
      key: `region:${r ? `${r.name}@${r.pos}` : `${t.name}@${t.pos}`}`, kind: 'region', value: `${t.pos}:${t.length}`, text,
      has: (f) => f.regions.some((x) => sameRegion(x, t.name, t.pos, t.length)),
    })
  }
  for (const r of base.regions) {
    if (r.pos === null || (rb.get(r.id)?.pos ?? null) !== null) continue
    out.push({ key: `region:${r.name}@${r.pos}`, kind: 'region', value: 'gone', text: `Delete the region ${label(r)} at bar ${bar(r.pos)} (they removed it)`, has: (f) => !f.regions.some((x) => sameRegion(x, r.name, r.pos)) })
  }

  // MIDI notes and automation: as sets of points.
  const nAdd = minus(side.notes, base.notes), nGone = minus(base.notes, side.notes)
  if (nAdd.length) out.push({ key: 'notes:added', kind: 'notes', value: nAdd.join('|'), text: `Bring over ${nAdd.length} MIDI ${nAdd.length === 1 ? 'note' : 'notes'} they added`, has: (f) => containsAll(f.notes, nAdd) })
  if (nGone.length) out.push({ key: 'notes:removed', kind: 'notes', value: nGone.join('|'), text: `Delete ${nGone.length} MIDI ${nGone.length === 1 ? 'note' : 'notes'} they removed`, has: (f) => minus(nGone, minus(base.notes, f.notes)).length === 0 })
  const aAdd = minus(side.automation, base.automation)
  if (aAdd.length) out.push({ key: 'automation:added', kind: 'automation', value: aAdd.join('|'), text: `Bring over ${aAdd.length} automation ${aAdd.length === 1 ? 'point' : 'points'} they added`, has: (f) => containsAll(f.automation, aAdd) })
  return out
}

const plain = ({ key, kind, text, conflict }: Step): MergeStep => (conflict ? { key, kind, text, conflict } : { key, kind, text })

/**
 * The to-do list for bringing `theirs` into the project in your folder.
 * `base` is the version both saved on top of, `mine` your newest version, and
 * `folder` what the folder holds now (your version, or your version with some of
 * theirs brought over). Run it again after saving in Logic to see what's left.
 */
export function mergePlan(base: LogicFacts, mine: LogicFacts, theirs: LogicFacts, folder: LogicFacts, opts: DiffOptions = {}): MergePlan {
  if (!base.trusted || !mine.trusted || !theirs.trusted || !folder.trusted) return { readable: false, todo: [], done: [], yours: [] }
  const ours = stepsBetween(base, mine, opts)
  const oursByKey = new Map(ours.map((s) => [s.key, s]))
  const todo: MergeStep[] = []
  const done: MergeStep[] = []
  for (const s of stepsBetween(base, theirs, opts)) {
    if (s.has(folder)) { done.push(plain(s)); continue }
    const mineToo = oursByKey.get(s.key)
    if (mineToo && mineToo.value !== s.value) s.conflict = `You changed this too: ${mineToo.text.charAt(0).toLowerCase()}${mineToo.text.slice(1)}`
    todo.push(plain(s))
  }
  return { readable: true, todo, done, yours: ours.map(plain) }
}
