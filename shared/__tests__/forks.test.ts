import { describe, it, expect } from 'vitest'
import { placeIncoming, adoptHubPlacement, openParallelVersions, forkBranchName } from '../forks'
import { mergeLogs, toSharedLog, type SharedLog } from '../hub-protocol'

const v = (id: string, author: string, ts: string, parent?: string, extra: object = {}) =>
  ({ commit_id: id, author, timestamp: ts, message: id, ...(parent ? { parent } : {}), ...extra })
const log = (branches: Record<string, any[]>): SharedLog =>
  ({ id: 'p', name: 'Song', daw: 'Logic', branches: Object.entries(branches).map(([name, commits]) => ({ name, commits })) })
const ids = (l: SharedLog, branch: string) => l.branches.find((b) => b.name === branch)?.commits.map((c) => c.commit_id) ?? []

const hub = log({ main: [v('base', 'max', '20260201100000'), v('A', 'max', '20260201110000', 'base')] })

describe('placing versions that reach the hub', () => {
  it('moves a version saved by someone else on the same version into an alternative named after them', () => {
    const placed = placeIncoming(hub, log({ main: [v('base', 'max', '20260201100000'), v('B', 'bob', '20261125120000', 'base')] }))
    const merged = mergeLogs(hub, placed)
    expect(ids(merged, 'main')).toEqual(['base', 'A'])
    expect(ids(merged, 'bob · 25 Nov')).toEqual(['B'])
    expect(merged.branches.find((b) => b.name === 'bob · 25 Nov')!.forkOf).toEqual({ branch: 'main', parent: 'base', author: 'bob' })
  })

  it('takes the versions saved on top of a moved one along', () => {
    const placed = placeIncoming(hub, log({ main: [v('B1', 'bob', '20261125120000', 'base'), v('B2', 'bob', '20261125130000', 'B1')] }))
    expect(ids(mergeLogs(hub, placed), 'bob · 25 Nov')).toEqual(['B1', 'B2'])
  })

  it('keeps a straight line: continuing the newest version, old versions without parents, and going back to your own', () => {
    expect(ids(mergeLogs(hub, placeIncoming(hub, log({ main: [v('C', 'bob', '20260201120000', 'A')] }))), 'main')).toEqual(['base', 'A', 'C'])
    expect(ids(mergeLogs(hub, placeIncoming(hub, log({ main: [v('old', 'bob', '20260201120000')] }))), 'main')).toEqual(['base', 'A', 'old'])
    expect(ids(mergeLogs(hub, placeIncoming(hub, log({ main: [v('again', 'max', '20260201120000', 'base')] }))), 'main')).toEqual(['base', 'A', 'again'])
  })

  it('never moves versions the hub already has, and leaves the rest of the incoming log alone', () => {
    const placed = placeIncoming(hub, log({ main: [v('A', 'max', '20260201110000', 'base')], ideas: [v('I', 'bob', '20260201120000', 'A')] }))
    expect(placed.branches.map((b) => b.name)).toEqual(['main', 'ideas'])
  })

  it('names alternatives uniquely and after the alternative they split from', () => {
    const withFork = mergeLogs(hub, placeIncoming(hub, log({ main: [v('B', 'bob', '20261125120000', 'base')] })))
    const again = placeIncoming(withFork, log({ main: [v('B9', 'bob', '20261125150000', 'A')], 'bob · 25 Nov': [] }))
    expect(again.branches.map((b) => b.name)).toContain('main')
    const hub2 = log({ main: [v('base', 'max', '20260201100000'), v('A', 'max', '20260201110000', 'base'), v('X', 'cleo', '20260201120000', 'A')] })
    const twice = mergeLogs(withFork, placeIncoming(withFork, log({ main: [v('B3', 'bob', '20261125160000', 'base')] })))
    expect(twice.branches.map((b) => b.name)).toContain('bob · 25 Nov (2)')
    expect(forkBranchName('bob', '20261125120000', 'louder chorus')).toBe('louder chorus · bob · 25 Nov')
    expect(forkBranchName('', 'garbage', 'main')).toBe('someone')
    expect(ids(mergeLogs(hub2, placeIncoming(hub2, log({ main: [v('Y', 'bob', '20260201130000', 'A')] }))), 'bob · 1 Feb')).toEqual(['Y'])
  })

  it('keeps parents and fork info through the shared log format', () => {
    const shared = toSharedLog({ branches: [{ name: 'x', forkOf: { branch: 'main', parent: 'base', author: 'bob' }, commits: [v('B', 'bob', '1', 'base', { merged_from: 'Z' })] }] })
    expect(shared.branches[0]).toMatchObject({ forkOf: { branch: 'main', parent: 'base', author: 'bob' }, commits: [{ parent: 'base', merged_from: 'Z' }] })
    expect(toSharedLog({ branches: [{ name: 'x', forkOf: { branch: '' }, commits: [] }] }).branches[0].forkOf).toBeUndefined()
  })
})

describe('following the hub on this Mac', () => {
  it('moves your version where the hub put it, and follows it if it is checked out', () => {
    const local = { current_branch: 'main', lastCheckout: { commitId: 'B' }, branches: [{ name: 'main', commits: [v('base', 'max', '1'), v('B', 'bob', '2', 'base')] }] }
    const hubLog = log({ main: [v('base', 'max', '1'), v('A', 'max', '2', 'base')], 'bob · 25 Nov': [v('B', 'bob', '2', 'base')] })
    const adopted = adoptHubPlacement(local, hubLog)
    expect(adopted.current_branch).toBe('bob · 25 Nov')
    expect(adopted.branches[0].commits.map((c: any) => c.commit_id)).toEqual(['base'])
    const merged = mergeLogs(adopted, hubLog)
    expect(ids(merged as SharedLog, 'main')).toEqual(['base', 'A'])
    expect(ids(merged as SharedLog, 'bob · 25 Nov')).toEqual(['B'])
  })

  it('leaves versions the hub doesn’t know, and stays put when the checkout didn’t move', () => {
    const local = { current_branch: 'main', lastCheckout: { commitId: 'base' }, branches: [{ name: 'main', commits: [v('base', 'max', '1'), v('new', 'max', '3', 'base')] }] }
    const adopted = adoptHubPlacement(local, log({ main: [v('base', 'max', '1')] }))
    expect(adopted.current_branch).toBe('main')
    expect(adopted.branches[0].commits).toHaveLength(2)
  })
})

describe('open parallel versions', () => {
  const l = log({
    main: [v('base', 'max', '1'), v('A', 'max', '2', 'base')],
    'bob · 25 Nov': [v('B1', 'bob', '3', 'base'), v('B2', 'bob', '4', 'B1')],
    ideas: [v('I', 'max', '5', 'A')],
  })
  l.branches[1].forkOf = { branch: 'main', parent: 'base', author: 'bob' }

  it('lists forks of an alternative with their newest version', () => {
    expect(openParallelVersions(l, 'main')).toEqual([{ branch: 'bob · 25 Nov', author: 'bob', tip: l.branches[1].commits[1], from: 'main', parent: 'base' }])
    expect(openParallelVersions(l, 'ideas')).toEqual([])
  })

  it('drops a fork once one of its versions was made main', () => {
    const done = { ...l, branches: l.branches.map((b) => b.name === 'main' ? { ...b, commits: [...b.commits, v('M', 'max', '6', 'A', { merged_from: 'B2' })] } : b) }
    expect(openParallelVersions(done, 'main')).toEqual([])
  })
})
