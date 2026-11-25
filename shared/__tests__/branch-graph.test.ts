import { describe, it, expect } from 'vitest'
import { layoutBranchGraph } from '../branch-graph'

const c = (id: string, ts: string, parent?: string, extra: object = {}) => ({ commit_id: id, timestamp: ts, message: id, author: 'max', ...(parent ? { parent } : {}), ...extra })

describe('alternatives map layout', () => {
  const branches = [
    { name: 'drums', commits: [c('d1', '03', 'm2'), c('d2', '05', 'd1')] },
    { name: 'main', commits: [c('m1', '01'), c('m2', '02', 'm1'), c('m3', '04', 'm2'), c('mm', '07', 'm3', { merged_from: 'b1' })] },
    { name: 'bob · 25 Nov', forkOf: { branch: 'main', parent: 'm3', author: 'bob' }, commits: [c('b1', '06', 'm3', { author: 'bob' })] },
    { name: 'empty', commits: [] },
  ]

  it('puts main on top, then alternatives by when they started, and leaves out empty ones', () => {
    const g = layoutBranchGraph(branches, 'm3')
    expect(g.lanes.map((l) => [l.name, l.parallel])).toEqual([['main', false], ['drums', false], ['bob · 25 Nov', true]])
  })

  it('orders versions by time across lanes and marks the current one', () => {
    const g = layoutBranchGraph(branches, 'm3')
    expect(g.nodes.map((n) => `${n.id}@${n.lane}:${n.col}`)).toEqual(['m1@0:0', 'm2@0:1', 'd1@1:2', 'm3@0:3', 'd2@1:4', 'b1@2:5', 'mm@0:6'])
    expect(g.nodes.filter((n) => n.current).map((n) => n.id)).toEqual(['m3'])
  })

  it('draws lines along a lane, forks where an alternative split off, and merges for "make main"', () => {
    const edges = layoutBranchGraph(branches).edges.map((e) => `${e.from}>${e.to}:${e.kind}`).sort()
    expect(edges).toEqual(['b1>mm:merge', 'd1>d2:line', 'm1>m2:line', 'm2>d1:fork', 'm2>m3:line', 'm3>b1:fork', 'm3>mm:line'].sort())
  })

  it('links versions without a recorded parent in time order, and a fork to its split point', () => {
    const g = layoutBranchGraph([
      { name: 'main', commits: [c('a', '01'), c('b', '02')] },
      { name: 'ann · 1 Feb', forkOf: { branch: 'main', parent: 'a', author: 'ann' }, commits: [c('x', '03')] },
    ])
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.kind}`)).toEqual(['a>b:line', 'a>x:fork'])
  })

  it('marks versions DAWLab kept automatically', () => {
    const g = layoutBranchGraph([{ name: 'main', commits: [c('a', '01'), c('k', '02', 'a', { auto: true })] }])
    expect(g.nodes.find((n) => n.id === 'k')!.auto).toBe(true)
  })
})
