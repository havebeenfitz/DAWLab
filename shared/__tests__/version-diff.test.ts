// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { diffFileMaps, diffPlugins } from '../version-diff'

const f = (path: string, hash: string) => ({ path, hash })

describe('diffFileMaps', () => {
  it('sorts files into added, removed, changed, moved and unchanged', () => {
    const before = [f('song.als', 'a1'), f('Samples/kick.wav', 'k'), f('Samples/old.wav', 'o'), f('Bounce/mix.wav', 'm')]
    const after = [f('song.als', 'a2'), f('Samples/kick.wav', 'k'), f('Samples/new.wav', 'n'), f('Mixes/mix.wav', 'm')]
    const d = diffFileMaps(before, after)
    expect(d.changes).toEqual([
      { kind: 'renamed', path: 'Mixes/mix.wav', from: 'Bounce/mix.wav' },
      { kind: 'added', path: 'Samples/new.wav' },
      { kind: 'removed', path: 'Samples/old.wav' },
      { kind: 'modified', path: 'song.als' },
    ])
    expect(d).toMatchObject({ added: 1, removed: 1, modified: 1, renamed: 1, unchanged: 1 })
  })

  it('treats everything as added for a first version', () => {
    const d = diffFileMaps(null, [f('a.wav', '1'), f('b.wav', '2')])
    expect(d.added).toBe(2)
    expect(d.changes.every(c => c.kind === 'added')).toBe(true)
  })

  it('ignores folder placeholders and DAWLab storage', () => {
    const d = diffFileMaps([f('Samples', 'empty')], [f('Samples', 'empty'), f('.dawlabproject/x', 'z'), f('.dawlabproject', 'y')])
    expect(d.changes).toEqual([])
    expect(d.unchanged).toBe(0)
  })

  it('pairs duplicate moved copies one to one', () => {
    const d = diffFileMaps([f('a/x.wav', 'h'), f('a/y.wav', 'h')], [f('b/x.wav', 'h'), f('b/y.wav', 'h'), f('b/z.wav', 'h')])
    expect(d.renamed).toBe(2)
    expect(d.added).toBe(1)
    expect(d.removed).toBe(0)
  })

  it('reports nothing for identical versions', () => {
    const files = [f('a', '1'), f('b', '2')]
    expect(diffFileMaps(files, files)).toMatchObject({ changes: [], unchanged: 2 })
  })
})

describe('diffPlugins', () => {
  const p = (name: string, count = 1, manufacturer = 'FabFilter') => ({ name, manufacturer, count })

  it('finds added, removed and count changes, added first', () => {
    const d = diffPlugins([p('Pro-Q 3', 2), p('Pro-C 2'), p('Serum', 1, 'Xfer')], [p('Pro-Q 3', 3), p('Serum', 1, 'Xfer'), p('Valhalla Room', 1, 'Valhalla')])
    expect(d.changes.map(c => [c.kind, c.plugin.name, c.before, c.after])).toEqual([
      ['added', 'Valhalla Room', 0, 1],
      ['removed', 'Pro-C 2', 1, 0],
      ['count', 'Pro-Q 3', 2, 3],
      ['same', 'Serum', 1, 1],
    ])
    expect(d).toMatchObject({ added: 1, removed: 1, countChanged: 1 })
  })

  it('matches names case-insensitively and treats Unknown vendor as none', () => {
    const d = diffPlugins([{ name: 'serum', manufacturer: 'Unknown' }], [{ name: 'Serum' }])
    expect(d.changes).toEqual([{ kind: 'same', plugin: { name: 'Serum' }, before: 1, after: 1 }])
  })

  it('sums duplicates and skips nameless entries', () => {
    const d = diffPlugins([], [p('Pro-Q 3'), p('Pro-Q 3', 2), { name: '' }])
    expect(d.changes).toEqual([{ kind: 'added', plugin: p('Pro-Q 3'), before: 0, after: 3 }])
  })

  it('marks everything added for a first version', () => {
    expect(diffPlugins(null, [p('A'), p('B')]).added).toBe(2)
  })
})
