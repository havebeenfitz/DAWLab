import { describe, it, expect, vi } from 'vitest'
import { cleanUpPreviewProjects } from '../preview-cleanup'

describe('cleaning up previews added as projects', () => {
  it('takes them out of the shared folder and the library, and leaves real projects alone', async () => {
    const removeFromSpace = vi.fn(async () => ({ removedOnHub: true }))
    const removeFromLibrary = vi.fn(async (t: Array<{ id: string; name: string }>) => ({ removed: t.map((x) => x.name) }))
    const removed = await cleanUpPreviewProjects({
      projects: () => [
        { id: '1', name: 'test', path: '/Music/Chigura/test' },
        { id: '2', name: 'test (preview · elenadanilova)', path: '/Music/Chigura/test (preview · elenadanilova)' },
        { id: '3', name: 'test (preview · elena) 2', path: null },
      ],
      removeFromSpace,
      removeFromLibrary,
    })
    expect(removed).toEqual(['test (preview · elenadanilova)', 'test (preview · elena) 2'])
    expect(removeFromSpace.mock.calls.map((c) => c[0])).toEqual(['test (preview · elenadanilova)', 'test (preview · elena) 2'])
    expect(removeFromLibrary).toHaveBeenCalledWith([{ id: '2', name: 'test (preview · elenadanilova)' }, { id: '3', name: 'test (preview · elena) 2' }])
  })

  it('still removes it locally when the hub refuses (you are not the owner)', async () => {
    const removeFromLibrary = vi.fn(async (t: Array<{ id: string; name: string }>) => ({ removed: t.map((x) => x.name) }))
    const removed = await cleanUpPreviewProjects({
      projects: () => [{ id: '2', name: 'x (preview · bob)', path: '/a/x (preview · bob)' }],
      removeFromSpace: async () => { throw new Error('forbidden') },
      removeFromLibrary,
    })
    expect(removed).toEqual(['x (preview · bob)'])
  })

  it('does nothing when there are none', async () => {
    const removeFromLibrary = vi.fn()
    expect(await cleanUpPreviewProjects({ projects: () => [{ id: '1', name: 'song', path: '/s' }], removeFromSpace: vi.fn(), removeFromLibrary })).toEqual([])
    expect(removeFromLibrary).not.toHaveBeenCalled()
  })
})
