import { describe, it, expect } from 'vitest'
import { dawPidsIn, lsofHoldsFolder } from '../daw-running'

describe('dawPidsIn', () => {
  const ps = [
    '  101 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder',
    '  202 /Applications/Logic Pro.app/Contents/MacOS/Logic Pro',
    '  303 /Applications/Ableton Live 12 Suite.app/Contents/MacOS/Live',
  ]
  it('finds the app for the project’s DAW and its process ids', () => {
    expect(dawPidsIn(ps, 'Logic Pro')).toEqual({ app: 'Logic Pro', pids: [202] })
    expect(dawPidsIn(ps, 'Ableton')).toEqual({ app: 'Ableton Live', pids: [303] })
  })
  it('finds nothing when the DAW isn’t running', () => {
    expect(dawPidsIn(ps.slice(0, 1), 'Logic Pro')).toEqual({ app: null, pids: [] })
  })
})

describe('lsofHoldsFolder', () => {
  const out = ['p202', 'fcwd', 'n/', 'f12', 'n/Users/max/Music/Logic/snow/snow.logicx/Media/Audio Files/Bass.wav', 'f13', 'n/Users/max/Music/Logic/snowfall/x.wav'].join('\n')
  it('is true when a file inside the folder is open', () => {
    expect(lsofHoldsFolder(out, '/Users/max/Music/Logic/snow')).toBe(true)
    expect(lsofHoldsFolder(out, '/Users/max/Music/Logic/snow/')).toBe(true)
  })
  it('does not match a folder that only starts with the same name', () => {
    expect(lsofHoldsFolder(out, '/Users/max/Music/Logic/snowf')).toBe(false)
    expect(lsofHoldsFolder('p1\nn/Users/max/Music/Logic/snowfall/x.wav', '/Users/max/Music/Logic/snow')).toBe(false)
  })
})
