import { describe, it, expect } from 'vitest'
import { BAR1, barOf, diffLogicFacts, lostSince, summarizeChanges, type LogicFacts, type LogicStrip } from '../logic-project'
import { mergePlan } from '../logic-merge'

const BAR = 3840 // one 4/4 bar in ticks
const at = (bar: number) => BAR1 + (bar - 1) * BAR
const strip = (name: string, over: Partial<LogicStrip> = {}): LogicStrip => ({ id: name, name, volume: 90, pan: 0, mute: false, solo: false, plugins: [], ...over })
const facts = (over: Partial<LogicFacts> = {}): LogicFacts => ({
  trusted: true, problems: [], markers: [], tempo: [{ pos: BAR1, bpm: 120 }], strips: [], regions: [], notes: [], automation: [], ...over,
})

describe('barOf', () => {
  it('counts bars from bar 1 in 4/4 and 3/4, with the beat when it isn’t the first', () => {
    expect(barOf(BAR1, 4, 4)).toBe('1')
    expect(barOf(at(14), 4, 4)).toBe('14')
    expect(barOf(at(14) + 960, 4, 4)).toBe('14.2')
    expect(barOf(BAR1 + 2880 * 2, 3, 4)).toBe('3')
  })
})

describe('diffLogicFacts', () => {
  it('says nothing when nothing changed', () => {
    const f = facts({ markers: [{ name: 'Intro', pos: at(1) }], strips: [strip('Bass')] })
    expect(diffLogicFacts(f, structuredClone(f))).toEqual([])
  })

  it('names markers added, moved and removed, with bars', () => {
    const a = facts({ markers: [{ name: 'Intro', pos: at(1) }, { name: 'Chorus', pos: at(14) }] })
    const b = facts({ markers: [{ name: 'Chorus', pos: at(18) }, { name: 'Outro', pos: at(93) }] })
    const lines = diffLogicFacts(a, b)
    expect(lines.map((l) => l.text)).toEqual([
      'Marker “Chorus” moved from bar 14 to 18',
      'Marker “Outro” added at bar 93',
      'Marker “Intro” removed (was at bar 1)',
    ])
    expect(lines.find((l) => l.kind === 'marker-removed')?.loss).toBe(true)
  })

  it('matches strips by name, so inserting a strip is not a rename', () => {
    const a = facts({ strips: [strip('Bass', { id: '1' }), strip('Gtr', { id: '2' })] })
    const b = facts({ strips: [strip('Keys', { id: '1' }), strip('Bass', { id: '2' }), strip('Gtr', { id: '3' })] })
    expect(diffLogicFacts(a, b).map((l) => l.text)).toEqual(['Channel strip “Keys” added'])
  })

  it('puts a strip’s changes on one line and a removed plugin on its own', () => {
    const a = facts({ strips: [strip('Bass', { plugins: [{ name: 'ChromaVerb', bypassed: false }, { name: 'Tape', bypassed: false }] })] })
    const b = facts({ strips: [strip('Bass', { volume: 95, pan: -20, mute: true, plugins: [{ name: 'ChromaVerb', bypassed: true }] })] })
    const lines = diffLogicFacts(a, b)
    expect(lines.map((l) => l.text)).toEqual([
      '“Bass”: volume up, pan centre → L20, muted, ChromaVerb bypassed',
      '“Bass”: plugin Tape removed',
    ])
    expect(lines[1].loss).toBe(true)
  })

  it('folds many regions into one line that lists them', () => {
    const regions = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, name: `take ${i}`, pos: at(i + 1), length: 48000, offset: 0 }))
    const lines = diffLogicFacts(facts(), facts({ regions }))
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('6 regions added')
    expect(lines[0].items).toHaveLength(6)
  })

  it('reads an untrusted project as one cautious line', () => {
    expect(diffLogicFacts(facts(), facts({ trusted: false }))).toEqual([{ kind: 'other', text: expect.stringMatching(/not readable/) }])
  })
})

describe('lostSince', () => {
  it('lists only what is gone', () => {
    const a = facts({ markers: [{ name: 'Intro', pos: at(1) }], strips: [strip('Bass'), strip('Pad')] })
    const b = facts({ markers: [{ name: 'Intro', pos: at(1) }, { name: 'Bridge', pos: at(40) }], strips: [strip('Bass', { volume: 80 })] })
    expect(lostSince(a, b).map((l) => l.text)).toEqual(['Channel strip “Pad” removed'])
  })

  it('never guesses from an untrusted read', () => {
    expect(lostSince(facts({ strips: [strip('Pad')] }), facts({ trusted: false }))).toEqual([])
  })

  it('warns about a big drop in MIDI notes even when some were added', () => {
    const notes = Array.from({ length: 40 }, (_, i) => `${i * 960}:60:100:480:0`)
    const lost = lostSince(facts({ notes }), facts({ notes: [...notes.slice(0, 10), '1:61:100:480:0'] }))
    expect(lost.map((l) => l.text)).toEqual(['30 MIDI notes removed'])
  })
})

describe('summarizeChanges', () => {
  it('keeps the first lines and counts the rest', () => {
    const lines = ['a', 'b', 'c', 'd'].map((text) => ({ kind: 'other' as const, text }))
    expect(summarizeChanges(lines, 2)).toBe('a; b; and 2 more')
    expect(summarizeChanges([])).toBe('')
  })
})

describe('mergePlan', () => {
  const base = facts({ markers: [{ name: 'Chorus', pos: at(14) }], strips: [strip('Bass'), strip('Gtr')] })

  it('lists their changes, what the folder has, and clashes with yours', () => {
    const mine = facts({ markers: [{ name: 'Chorus', pos: at(16) }], strips: [strip('Bass', { volume: 80 }), strip('Gtr')] })
    const theirs = facts({
      markers: [{ name: 'Chorus', pos: at(18) }, { name: 'Bridge', pos: at(40) }],
      strips: [strip('Bass', { volume: 80 }), strip('Gtr', { pan: 30 }), strip('Keys', { plugins: [{ name: 'Alchemy', bypassed: false }] })],
    })
    const plan = mergePlan(base, mine, theirs, mine)
    expect(plan.readable).toBe(true)
    expect(plan.done.map((s) => s.key)).toEqual(['strip:Bass:volume'])
    expect(plan.todo.map((s) => s.text)).toEqual([
      'Move marker “Chorus” to bar 18',
      'Add marker “Bridge” at bar 40',
      'Bring over the track “Keys” (with Alchemy)',
      '“Gtr”: pan R30',
    ])
    expect(plan.todo[0].conflict).toMatch(/You changed this too: move marker “Chorus” to bar 16/)
    expect(plan.todo.slice(1).every((s) => !s.conflict)).toBe(true)
  })

  it('finds imported regions by name and place, whatever their ids', () => {
    const theirs = facts({ ...base, regions: [{ id: 'theirs-1', name: 'vox', pos: at(9), length: 96000, offset: 0 }] })
    const imported = facts({ ...base, regions: [{ id: 'mine-77', name: 'vox', pos: at(9), length: 96000, offset: 0 }] })
    expect(mergePlan(base, base, theirs, base).todo.map((s) => s.text)).toEqual(['Bring over the region “vox” at bar 9'])
    expect(mergePlan(base, base, theirs, imported).todo).toEqual([])
  })

  it('checks MIDI notes as a set', () => {
    const theirs = facts({ ...base, notes: ['0:60:100:480:0', '960:62:100:480:0'] })
    expect(mergePlan(base, base, theirs, facts({ ...base, notes: ['0:60:100:480:0'] })).todo.map((s) => s.text)).toEqual(['Bring over 2 MIDI notes they added'])
    expect(mergePlan(base, base, theirs, theirs).todo).toEqual([])
  })

  it('gives no plan when a side can’t be read with confidence', () => {
    expect(mergePlan(base, base, facts({ trusted: false }), base)).toEqual({ readable: false, todo: [], done: [], yours: [] })
  })
})
