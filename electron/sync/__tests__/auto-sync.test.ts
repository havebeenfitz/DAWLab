// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const spaces = vi.hoisted(() => ({
  listLocalSpaces: vi.fn(),
  getSpaceForProject: vi.fn(),
  syncSpace: vi.fn(),
}))
vi.mock('../spaces-client', () => spaces)

import { requestSpaceSync, requestProjectSync, syncAllSpaces, startAutoSync, stopAutoSync, type SyncStatus } from '../auto-sync'

const okResult = (folderId: string, extra: Record<string, unknown> = {}) => ({
  folderId, pushedVersions: 1, pulledVersions: 2, addedProjects: ['Lodge'], failed: [],
  space: { folderId, lastSync: '2026-02-01T10:00:00.000Z' }, ...extra,
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('auto-sync', () => {
  let statuses: SyncStatus[]

  beforeEach(() => {
    vi.useFakeTimers()
    statuses = []
    spaces.listLocalSpaces.mockReset().mockReturnValue([])
    spaces.getSpaceForProject.mockReset().mockReturnValue(null)
    spaces.syncSpace.mockReset()
    startAutoSync((s) => statuses.push(s), 60_000)
  })

  afterEach(() => {
    stopAutoSync()
    vi.useRealTimers()
  })

  it('reports syncing, progress and the result', async () => {
    spaces.syncSpace.mockImplementation(async (folderId: string, onProgress: (m: string) => void) => {
      onProgress('Syncing Snow...')
      return okResult(folderId)
    })
    const result = await requestSpaceSync('f1')
    expect(result?.pulledVersions).toBe(2)
    expect(statuses.map((s) => s.state)).toEqual(['syncing', 'syncing', 'synced'])
    expect(statuses[1].message).toBe('Syncing Snow...')
    expect(statuses[2]).toMatchObject({ folderId: 'f1', lastSync: '2026-02-01T10:00:00.000Z', result: { addedProjects: ['Lodge'] } })
  })

  it('reports projects that failed as an error, without throwing', async () => {
    spaces.syncSpace.mockResolvedValue(okResult('f1', { failed: [{ project: 'Snow', error: 'disk full' }] }))
    await requestSpaceSync('f1')
    expect(statuses.at(-1)).toMatchObject({ state: 'error', error: 'Snow: disk full' })
  })

  it('turns a failed sync into an error status and resolves to null', async () => {
    spaces.syncSpace.mockRejectedValue(new Error('You no longer have access'))
    await expect(requestSpaceSync('f1')).resolves.toBeNull()
    expect(statuses.at(-1)).toMatchObject({ state: 'error', error: 'You no longer have access' })
  })

  it('runs one sync per folder and queues exactly one more while it runs', async () => {
    const first = deferred<ReturnType<typeof okResult>>()
    spaces.syncSpace.mockReturnValueOnce(first.promise).mockResolvedValue(okResult('f1'))
    const a = requestSpaceSync('f1')
    const b = requestSpaceSync('f1')
    const c = requestSpaceSync('f1')
    expect(spaces.syncSpace).toHaveBeenCalledTimes(1)
    expect(b).toBe(a)
    expect(c).toBe(a)
    first.resolve(okResult('f1'))
    await a
    await vi.waitFor(() => expect(spaces.syncSpace).toHaveBeenCalledTimes(2))
  })

  it('syncs different folders in parallel', async () => {
    spaces.syncSpace.mockImplementation(async (folderId: string) => okResult(folderId))
    spaces.listLocalSpaces.mockReturnValue([{ folderId: 'f1' }, { folderId: 'f2' }])
    await syncAllSpaces()
    expect(spaces.syncSpace.mock.calls.map((c) => c[0]).sort()).toEqual(['f1', 'f2'])
  })

  it('syncs the folder a saved project is in, and nothing for unshared projects', async () => {
    spaces.syncSpace.mockImplementation(async (folderId: string) => okResult(folderId))
    await expect(requestProjectSync('Loose')).resolves.toBeNull()
    expect(spaces.syncSpace).not.toHaveBeenCalled()

    spaces.getSpaceForProject.mockReturnValue({ folderId: 'f9' })
    await requestProjectSync('Snow')
    expect(spaces.syncSpace).toHaveBeenCalledWith('f9', expect.any(Function))
  })

  it('syncs every folder shortly after start and then on the interval', async () => {
    spaces.syncSpace.mockImplementation(async (folderId: string) => okResult(folderId))
    spaces.listLocalSpaces.mockReturnValue([{ folderId: 'f1' }])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(spaces.syncSpace).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spaces.syncSpace).toHaveBeenCalledTimes(2)
    stopAutoSync()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(spaces.syncSpace).toHaveBeenCalledTimes(2)
  })
})
