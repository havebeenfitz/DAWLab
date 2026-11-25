// @vitest-environment node
import path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { removeProjectsFromLibrary } from '../remove-projects'

function deps(paths: Record<string, string | null> = {}) {
  return {
    deleteProject: vi.fn(async (_n: string) => ({ success: true })),
    getProjectPath: vi.fn((n: string) => (n in paths ? paths[n] : `/music/${n}`)),
    removeFromFolders: vi.fn(),
    ignorePath: vi.fn(),
  }
}

describe('removeProjectsFromLibrary', () => {
  it('deletes history, unfiles and ignores each project, leaving files alone', async () => {
    const d = deps()
    const res = await removeProjectsFromLibrary([{ id: '1', name: 'A' }, { id: 2, name: 'B' }], d)
    expect(res).toEqual({ removed: ['A', 'B'], failed: [] })
    expect(d.deleteProject.mock.calls.map(c => c[0])).toEqual(['A', 'B'])
    expect(d.removeFromFolders.mock.calls.map(c => c[0])).toEqual(['1', 2])
    expect(d.ignorePath.mock.calls.map(c => c[0])).toEqual([path.resolve('/music/A'), path.resolve('/music/B')])
  })

  it('reads the path before deleting, since deletion unregisters the project', async () => {
    const order: string[] = []
    const d = deps()
    d.getProjectPath.mockImplementation((n: string) => { order.push('path'); return `/m/${n}` })
    d.deleteProject.mockImplementation(async () => { order.push('delete'); return {} })
    await removeProjectsFromLibrary([{ id: '1', name: 'A' }], d)
    expect(order).toEqual(['path', 'delete'])
  })

  it('does not ignore projects without a real path', async () => {
    const d = deps({ A: null, B: 'NA' })
    const res = await removeProjectsFromLibrary([{ id: '1', name: 'A' }, { id: '2', name: 'B' }], d)
    expect(res.removed).toEqual(['A', 'B'])
    expect(d.ignorePath).not.toHaveBeenCalled()
  })

  it('keeps going after a failure and reports it', async () => {
    const d = deps()
    d.deleteProject.mockImplementation(async (n: string) => { if (n === 'B') throw new Error('locked'); return {} })
    const res = await removeProjectsFromLibrary([{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }], d)
    expect(res.removed).toEqual(['A', 'C'])
    expect(res.failed).toEqual([{ name: 'B', error: 'locked' }])
    expect(d.removeFromFolders).not.toHaveBeenCalledWith('2')
  })

  it('skips duplicates and malformed entries', async () => {
    const d = deps()
    const res = await removeProjectsFromLibrary(
      [{ id: '1', name: 'A' }, { id: '1', name: 'A' }, { id: '9', name: '' }, null as never, { id: 5, name: 7 as never }],
      d,
    )
    expect(res).toEqual({ removed: ['A'], failed: [] })
    expect(d.deleteProject).toHaveBeenCalledTimes(1)
  })

  it('handles an empty list', async () => {
    const d = deps()
    expect(await removeProjectsFromLibrary([], d)).toEqual({ removed: [], failed: [] })
    expect(d.deleteProject).not.toHaveBeenCalled()
  })

  it('reports non-Error throws as text', async () => {
    const d = deps()
    d.deleteProject.mockImplementation(async () => { throw 'nope' })
    const res = await removeProjectsFromLibrary([{ id: '1', name: 'A' }], d)
    expect(res.failed).toEqual([{ name: 'A', error: 'nope' }])
  })
})
