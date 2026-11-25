// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mergeLogs, mergeComments, parseShareLink, toSharedLog } from '../hub-protocol'

const log = (branches: any[]) => ({ id: 'p', name: 'Song', daw: 'Ableton Live', branches })

describe('hub protocol', () => {
  it('merges logs without losing versions from either side', () => {
    const local = { ...log([{ name: 'main', commits: [{ commit_id: '1', timestamp: '1', message: 'a', author: 'x' }] }]), lastCheckout: { commitId: '1' } }
    const remote = toSharedLog(log([
      { name: 'main', commits: [{ commit_id: '2', timestamp: '2', message: 'b', author: 'y' }, { commit_id: '1', timestamp: '1', message: 'a', author: 'x', preview_file: 'h' }] },
      { name: 'alt', commits: [] },
    ]))
    const merged: any = mergeLogs(local, remote)
    expect(merged.branches[0].commits.map((c: any) => c.commit_id)).toEqual(['1', '2'])
    expect(merged.branches[0].commits[0].preview_file).toBe('h')
    expect(merged.branches.map((b: any) => b.name)).toEqual(['main', 'alt'])
    expect(merged.lastCheckout).toEqual({ commitId: '1' })
  })

  it('never shares local-only state', () => {
    const shared: any = toSharedLog({ ...log([]), lastCheckout: {}, draft: {}, current_branch: 'x', collaborators: [] })
    expect(Object.keys(shared).sort()).toEqual(['branches', 'daw', 'id', 'name'])
  })

  it('merges comments and replies by id', () => {
    const merged = mergeComments(
      [{ id: 'a', comment: 'old', replies: [{ id: 'r1' }] }],
      [{ id: 'a', comment: 'edited', replies: [{ id: 'r2' }] }, { id: 'b', comment: 'new' }],
    )
    expect(merged).toEqual([
      { id: 'a', comment: 'edited', replies: [{ id: 'r1' }, { id: 'r2' }] },
      { id: 'b', comment: 'new' },
    ])
  })

  it('parses share links, including hubs under a path', () => {
    expect(parseShareLink('https://hub.example.com/s/abcdefghijklmnopqrstuvwx')).toEqual({ hubUrl: 'https://hub.example.com', token: 'abcdefghijklmnopqrstuvwx' })
    expect(parseShareLink(' https://x.io/dawlab/s/abcdefghijklmnopqrstuvwx/ ').hubUrl).toBe('https://x.io/dawlab')
    expect(() => parseShareLink('https://x.io/nope')).toThrow()
  })
})
