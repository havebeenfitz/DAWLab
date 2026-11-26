/**
 * Real Logic project data saved one edit at a time. The files are private
 * project data and not in the repository: point DAWLAB_LOGIC_FIXTURES at a
 * folder with lab/ (one edit per file) to run these.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { readLogicFacts, diffLogicFacts } from '../logic-project'
import { mergePlan } from '../logic-merge'

const root = process.env.DAWLAB_LOGIC_FIXTURES
const lab = (name: string) => readLogicFacts(fs.readFileSync(path.join(root!, 'lab', `${name}.ProjectData`)))
const suite = root && fs.existsSync(path.join(root, 'lab')) ? describe : describe.skip

suite('Logic project data from a real Logic', () => {
  const steps: Array<[string, string, RegExp]> = [
    ['02-control2', '03-tempo-121', /^Tempo .* → 121 BPM$/],
    ['03-tempo-121', '04-vol-audio1', /: volume (up|down)$/],
    ['04-vol-audio1', '06-pan-audio1', /: pan /],
    ['06-pan-audio1', '08-mute-audio1', /: muted$/],
    ['08-mute-audio1', '09-solo-audio1', /: (unmuted, )?solo on$/],
    ['09-solo-audio1', '10-bypass-mastering', /: plugin Mastering added$/],
    ['10-bypass-mastering', '11-unbypass-mastering', /switched back on$/],
    ['13-region-drag', '14-region-nudge-1bar', /^Region .* moved from bar/],
    ['14-region-nudge-1bar', '15-region-trim-end', /^Region .* (shortened|lengthened|trimmed)/],
    ['15-region-trim-end', '16-automation-points', /^Automation points: \d+ added$/],
    ['16-automation-points', '17-tempo-point-bar4', /^Tempo change added: .* at bar 4$/],
  ]
  it.each(steps)('%s -> %s is one line', (a, b, line) => {
    const lines = diffLogicFacts(lab(a), lab(b), { sampleRate: 48000 }).map((c) => c.text)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(line)
  })

  it('a region cut in two is one shorter region and one new one', () => {
    const lines = diffLogicFacts(lab('12-preset-next'), lab('13-region-drag'), { sampleRate: 48000 }).map((c) => c.text)
    expect(lines).toEqual([expect.stringMatching(/^Region “bass.1” shortened by/), expect.stringMatching(/^Region “bass.2” added at bar/)])
  })

  it('lists what to bring over, and sees it once the folder has it', () => {
    const base = lab('02-control2'), mine = lab('03-tempo-121'), theirs = lab('10-bypass-mastering')
    const before = mergePlan(base, mine, theirs, mine)
    expect(before.readable).toBe(true)
    // They also set 121 BPM on top of the same version: already in yours.
    expect(before.done.map((s) => s.key)).toContain('tempo:song')
    expect(before.todo.map((s) => s.text).join('\n')).toMatch(/volume[\s\S]*pan[\s\S]*solo on[\s\S]*add the plugin Mastering/)
    const after = mergePlan(base, mine, theirs, theirs)
    expect(after.todo).toEqual([])
  })
})
